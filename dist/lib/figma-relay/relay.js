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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Relay = exports.DEFAULT_HTTP_PORT = void 0;
exports.readSse = readSse;
exports.takeLock = takeLock;
exports.ensureServer = ensureServer;
exports.serve = serve;
exports.main = main;
/**
 * figma-console relay — one figma-console server per machine, shared by every
 * conversation.
 *
 * figma-console binds a port of 9223–9232 the moment it starts, whether or not
 * the conversation ever touches Figma, and the Desktop Bridge plugin only
 * reaches that range. Started once per conversation, ten open conversations
 * fill it and nothing else can serve the plugin.
 *
 * The plugin starts this relay instead. It binds no port. It makes sure one
 * shared figma-console is answering MCP over HTTP (figma-console-mcp ≥ 1.44,
 * FIGMA_MCP_HTTP_PORT), starting it if needed, and forwards the conversation's
 * stdio MCP messages to it. However many conversations are open, the range
 * holds one figma-console port.
 */
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const readline = __importStar(require("node:readline"));
exports.DEFAULT_HTTP_PORT = 9300;
const START_TIMEOUT_MS = 60_000;
const POLL_MS = 500;
/** A lock whose owner is alive is still honoured up to this age (guards against PID reuse). */
const MAX_LOCK_AGE_MS = 10 * 60_000;
class SessionLost extends Error {
}
class HttpError extends Error {
    status;
    constructor(status, body) {
        super(`HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ""}`);
        this.status = status;
    }
}
/** Connection refused/reset: the shared server is gone. */
function isNetworkError(error) {
    return error instanceof TypeError && /fetch failed/i.test(error.message);
}
/** Parse a `text/event-stream` body, calling `onMessage` for each JSON-RPC message. */
async function readSse(body, onMessage, log = () => { }) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let data = [];
    const flush = () => {
        if (data.length === 0)
            return;
        const payload = data.join("\n");
        data = [];
        if (!payload.trim())
            return;
        try {
            const parsed = JSON.parse(payload);
            for (const msg of Array.isArray(parsed) ? parsed : [parsed])
                onMessage(msg);
        }
        catch {
            log(`ignored a non-JSON event: ${payload.slice(0, 120)}`);
        }
    };
    const consume = (line) => {
        if (line.endsWith("\r"))
            line = line.slice(0, -1);
        if (line === "")
            flush();
        else if (line.startsWith("data:"))
            data.push(line.slice(5).replace(/^ /, ""));
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
            consume(buffer.slice(0, nl));
            buffer = buffer.slice(nl + 1);
        }
    }
    buffer += decoder.decode();
    if (buffer)
        consume(buffer);
    flush();
}
/**
 * Forwards one conversation's MCP messages to the shared server. When the
 * server drops the session (it closes idle ones after 30 minutes) or restarts,
 * the relay replays the conversation's `initialize` and resends the message,
 * so the conversation never notices.
 */
class Relay {
    opts;
    sessionId = null;
    protocolVersion = null;
    initRequest = null;
    recovering = null;
    stream = null;
    replays = 0;
    ready = Promise.resolve();
    constructor(opts) {
        this.opts = opts;
    }
    /** Start the shared server early, while the conversation is still connecting. */
    start() {
        this.ready = this.opts.ensureServer().catch((error) => {
            this.opts.log(`shared figma-console not reachable yet: ${String(error)}`);
        });
    }
    async handle(msg) {
        await this.ready;
        if (msg.method === "initialize")
            this.initRequest = msg;
        for (let attempt = 0;; attempt++) {
            const sessionAtSend = this.sessionId;
            try {
                await this.send(msg, true);
                if (msg.method === "notifications/initialized")
                    this.openStream();
                return;
            }
            catch (error) {
                const recoverable = error instanceof SessionLost || isNetworkError(error);
                if (!recoverable || attempt >= 1) {
                    this.fail(msg, error);
                    return;
                }
                // Another message may already have re-established the session.
                if (this.sessionId === sessionAtSend || this.sessionId === null) {
                    try {
                        await this.recover(msg.method === "initialize");
                    }
                    catch (recoverError) {
                        this.fail(msg, recoverError);
                        return;
                    }
                }
            }
        }
    }
    close() {
        this.stream?.abort();
        this.stream = null;
    }
    headers() {
        const headers = {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
        };
        if (this.sessionId)
            headers["mcp-session-id"] = this.sessionId;
        if (this.protocolVersion)
            headers["mcp-protocol-version"] = this.protocolVersion;
        return headers;
    }
    observe(msg) {
        const result = msg.result;
        if (result && typeof result.protocolVersion === "string") {
            this.protocolVersion = result.protocolVersion;
        }
    }
    async send(msg, deliver) {
        const res = await fetch(this.opts.url, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(msg),
        });
        if (res.status === 404 && this.sessionId) {
            await res.body?.cancel().catch(() => { });
            throw new SessionLost();
        }
        const sessionId = res.headers.get("mcp-session-id");
        if (sessionId)
            this.sessionId = sessionId;
        if (res.status === 202 || res.status === 204) {
            await res.body?.cancel().catch(() => { });
            return;
        }
        if (!res.ok)
            throw new HttpError(res.status, await res.text());
        const emit = (out) => {
            this.observe(out);
            if (deliver)
                this.opts.write(out);
        };
        if ((res.headers.get("content-type") ?? "").includes("text/event-stream") && res.body) {
            await readSse(res.body, emit, this.opts.log);
            return;
        }
        const text = await res.text();
        if (!text.trim())
            return;
        const parsed = JSON.parse(text);
        for (const out of Array.isArray(parsed) ? parsed : [parsed])
            emit(out);
    }
    recover(failedOnInitialize) {
        this.recovering ??= (async () => {
            this.close();
            this.sessionId = null;
            await this.opts.ensureServer();
            if (failedOnInitialize || !this.initRequest)
                return;
            const replay = { ...this.initRequest, id: `bridge-relay-reinit-${++this.replays}` };
            await this.send(replay, false);
            await this.send({ jsonrpc: "2.0", method: "notifications/initialized" }, false);
            this.openStream();
            this.opts.log("session re-established with the shared figma-console");
        })().finally(() => {
            this.recovering = null;
        });
        return this.recovering;
    }
    /** Answer a request the server could not take, so the conversation never hangs on it. */
    fail(msg, error) {
        this.opts.log(`could not forward ${String(msg.method ?? "a response")}: ${String(error)}`);
        if (msg.id === undefined || typeof msg.method !== "string")
            return;
        this.opts.write({
            jsonrpc: "2.0",
            id: msg.id,
            error: {
                code: -32603,
                message: `Bridge could not reach the shared figma-console at ${this.opts.url}: ${String(error)}`,
            },
        });
    }
    /** Server-initiated messages (notifications, requests) arrive on a standalone GET stream. */
    openStream() {
        this.close();
        const controller = new AbortController();
        this.stream = controller;
        const sessionId = this.sessionId;
        void (async () => {
            while (!controller.signal.aborted && this.sessionId === sessionId) {
                try {
                    const headers = this.headers();
                    headers.accept = "text/event-stream";
                    delete headers["content-type"];
                    const res = await fetch(this.opts.url, {
                        method: "GET",
                        headers,
                        signal: controller.signal,
                    });
                    if (!res.ok || !res.body) {
                        await res.body?.cancel().catch(() => { });
                        return; // 405: the server offers no standalone stream; 404: recovery reopens it.
                    }
                    await readSse(res.body, (out) => this.opts.write(out), this.opts.log);
                }
                catch {
                    if (controller.signal.aborted)
                        return;
                }
                await sleep(2_000);
            }
        })();
    }
}
exports.Relay = Relay;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function ownerAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === "EPERM";
    }
}
/** Take the start lock, reclaiming it from a relay that died while holding it. */
function takeLock(lockPath) {
    try {
        fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
        return true;
    }
    catch (error) {
        if (error.code !== "EEXIST")
            throw error;
    }
    try {
        const owner = Number(fs.readFileSync(lockPath, "utf8"));
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (owner && ownerAlive(owner) && age < MAX_LOCK_AGE_MS)
            return false;
        fs.rmSync(lockPath, { force: true });
    }
    catch {
        return false; // Released between our two reads; the next poll will see the server or the lock.
    }
    return takeLock(lockPath);
}
async function ensureServer(ctl, log, timeoutMs = START_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await ctl.isUp())
            return;
        if (takeLock(ctl.lockPath)) {
            try {
                if (await ctl.isUp())
                    return; // Started by a relay that released the lock just now.
                log("starting the shared figma-console");
                ctl.start();
                while (Date.now() < deadline) {
                    await sleep(POLL_MS);
                    if (await ctl.isUp())
                        return;
                }
            }
            finally {
                fs.rmSync(ctl.lockPath, { force: true });
            }
            break;
        }
        await sleep(POLL_MS);
    }
    throw new Error(`the shared figma-console did not answer within ${timeoutMs / 1000}s`);
}
/** Any HTTP answer on the endpoint means a server is listening there. */
async function isUp(url) {
    try {
        const res = await fetch(url, {
            method: "GET",
            headers: { accept: "text/event-stream" },
            signal: AbortSignal.timeout(2_000),
        });
        await res.body?.cancel().catch(() => { });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Start the keeper detached, so the shared server outlives the conversation
 * that started it. `entry` is the relay's own script, run with `--serve`.
 */
function startServer(entry, port, log) {
    const child = (0, node_child_process_1.spawn)(process.execPath, [entry, "--serve"], {
        env: { ...process.env, FIGMA_MCP_HTTP_PORT: String(port) },
        detached: true,
        stdio: "ignore",
        windowsHide: true,
    });
    child.on("error", (error) => log(`could not start figma-console: ${error.message}`));
    child.unref();
}
/**
 * The keeper: runs figma-console and holds its stdin open. figma-console exits
 * as soon as its stdin closes — that is how it notices a client went away — so
 * a server meant to outlive every conversation needs a stdin nobody closes.
 * Its log goes to a file in the temp directory, rewritten at each start.
 */
function serve() {
    const logPath = path.join(os.tmpdir(), "bridge-figma-console.log");
    const logFd = fs.openSync(logPath, "w");
    const child = (0, node_child_process_1.spawn)("npx -y figma-console-mcp@latest", {
        shell: true, // npx is a .cmd shim on Windows
        stdio: ["pipe", "ignore", logFd],
        windowsHide: true,
    });
    child.on("exit", (code) => process.exit(code ?? 0));
}
function main() {
    if (process.argv.includes("--serve")) {
        serve();
        return;
    }
    const port = Number(process.env.BRIDGE_FIGMA_HTTP_PORT) || exports.DEFAULT_HTTP_PORT;
    const url = `http://127.0.0.1:${port}/mcp`;
    const log = (line) => process.stderr.write(`[bridge figma-relay] ${line}\n`);
    const entry = process.argv[1];
    const ctl = {
        isUp: () => isUp(url),
        start: () => startServer(entry, port, log),
        lockPath: path.join(os.tmpdir(), `bridge-figma-console-${port}.lock`),
    };
    const relay = new Relay({
        url,
        write: (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`),
        ensureServer: () => ensureServer(ctl, log),
        log,
    });
    relay.start();
    const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    lines.on("line", (line) => {
        if (!line.trim())
            return;
        let msg;
        try {
            msg = JSON.parse(line);
        }
        catch {
            log(`ignored a non-JSON line: ${line.slice(0, 120)}`);
            return;
        }
        void relay.handle(msg);
    });
    // The conversation closed: stop relaying. The shared server stays up for the others.
    lines.on("close", () => {
        relay.close();
        process.exit(0);
    });
}
//# sourceMappingURL=relay.js.map