"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs"));
const http = __importStar(require("node:http"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const relay_js_1 = require("./relay.js");
function streamOf(chunks) {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks)
                controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    });
}
(0, node_test_1.test)("readSse joins events split across chunks and CRLF line endings", async () => {
    const seen = [];
    await (0, relay_js_1.readSse)(streamOf(['event: message\r\ndata: {"id":1,', '"result":{}}\r\n\r\n', 'data: {"id":2}\n\n']), (msg) => seen.push(msg));
    strict_1.default.deepEqual(seen, [{ id: 1, result: {} }, { id: 2 }]);
});
/** Minimal Streamable HTTP MCP server: JSON for initialize, SSE for the rest, sessions that can expire. */
async function fakeServer() {
    const state = { session: 0, live: new Set(), initializeIds: [] };
    const server = http.createServer((req, res) => {
        if (req.method === "GET") {
            res.writeHead(405).end();
            return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            const msg = JSON.parse(body);
            if (msg.method === "initialize") {
                const id = `s${++state.session}`;
                state.live.add(id);
                state.initializeIds.push(msg.id);
                res.writeHead(200, { "content-type": "application/json", "mcp-session-id": id });
                res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18" } }));
                return;
            }
            if (!state.live.has(String(req.headers["mcp-session-id"]))) {
                res.writeHead(404).end();
                return;
            }
            if (msg.id === undefined) {
                res.writeHead(202).end();
                return;
            }
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: msg.method } })}\n\n`);
        });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    return { state, url: `http://127.0.0.1:${port}/mcp`, close: () => server.close() };
}
(0, node_test_1.test)("relay forwards a conversation and survives an expired session", async () => {
    const fake = await fakeServer();
    const written = [];
    let ensured = 0;
    const relay = new relay_js_1.Relay({
        url: fake.url,
        write: (msg) => written.push(msg),
        ensureServer: async () => {
            ensured++;
        },
        log: () => { },
    });
    try {
        await relay.handle({
            jsonrpc: "2.0",
            id: 0,
            method: "initialize",
            params: { clientInfo: { name: "t" } },
        });
        await relay.handle({ jsonrpc: "2.0", method: "notifications/initialized" });
        await relay.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
        fake.state.live.clear(); // the server closes the idle session
        await relay.handle({ jsonrpc: "2.0", id: 2, method: "tools/call" });
        strict_1.default.deepEqual(written.map((m) => m.id), [0, 1, 2], "the replayed initialize must not reach the conversation");
        strict_1.default.deepEqual(written[2].result.ok, "tools/call");
        strict_1.default.deepEqual(fake.state.initializeIds, [0, "bridge-relay-reinit-1"]);
        strict_1.default.equal(ensured, 1, "recovery checks the server is up before re-initializing");
    }
    finally {
        relay.close();
        fake.close();
    }
});
(0, node_test_1.test)("relay answers a request with an error when the server stays unreachable", async () => {
    const written = [];
    const relay = new relay_js_1.Relay({
        url: "http://127.0.0.1:9/mcp", // discard port: nothing listens
        write: (msg) => written.push(msg),
        ensureServer: async () => { },
        log: () => { },
    });
    await relay.handle({ jsonrpc: "2.0", id: 5, method: "initialize", params: {} });
    strict_1.default.equal(written.length, 1);
    strict_1.default.equal(written[0].id, 5);
    strict_1.default.ok(written[0].error, "the conversation gets an error instead of waiting forever");
});
(0, node_test_1.test)("simultaneous relays start the shared server once", async () => {
    const lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bridge-relay-")), "start.lock");
    let up = false;
    let starts = 0;
    const ctl = {
        isUp: async () => up,
        start: () => {
            starts++;
            setTimeout(() => (up = true), 50);
        },
        lockPath,
    };
    await Promise.all([(0, relay_js_1.ensureServer)(ctl, () => { }, 5_000), (0, relay_js_1.ensureServer)(ctl, () => { }, 5_000)]);
    strict_1.default.equal(starts, 1);
    strict_1.default.equal(fs.existsSync(lockPath), false, "the lock is released once the server answers");
});
(0, node_test_1.test)("a lock left by a dead relay is reclaimed", () => {
    const lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bridge-relay-")), "start.lock");
    fs.writeFileSync(lockPath, "999999999"); // no such process
    strict_1.default.equal((0, relay_js_1.takeLock)(lockPath), true);
    strict_1.default.equal((0, relay_js_1.takeLock)(lockPath), false, "a lock held by a live process is honoured");
});
//# sourceMappingURL=relay.test.js.map