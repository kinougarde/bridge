import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { ensureServer, readSse, Relay, takeLock, type Message } from "./relay.js";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

test("readSse joins events split across chunks and CRLF line endings", async () => {
  const seen: Message[] = [];
  await readSse(
    streamOf(['event: message\r\ndata: {"id":1,', '"result":{}}\r\n\r\n', 'data: {"id":2}\n\n']),
    (msg) => seen.push(msg)
  );
  assert.deepEqual(seen, [{ id: 1, result: {} }, { id: 2 }]);
});

/** Minimal Streamable HTTP MCP server: JSON for initialize, SSE for the rest, sessions that can expire. */
async function fakeServer() {
  const state = { session: 0, live: new Set<string>(), initializeIds: [] as unknown[] };
  const server = http.createServer((req, res) => {
    if (req.method === "GET") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const msg = JSON.parse(body) as Message;
      if (msg.method === "initialize") {
        const id = `s${++state.session}`;
        state.live.add(id);
        state.initializeIds.push(msg.id);
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": id });
        res.end(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18" } })
        );
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
      res.end(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: msg.method } })}\n\n`
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { state, url: `http://127.0.0.1:${port}/mcp`, close: () => server.close() };
}

test("relay forwards a conversation and survives an expired session", async () => {
  const fake = await fakeServer();
  const written: Message[] = [];
  let ensured = 0;
  const relay = new Relay({
    url: fake.url,
    write: (msg) => written.push(msg),
    ensureServer: async () => {
      ensured++;
    },
    log: () => {},
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

    assert.deepEqual(
      written.map((m) => m.id),
      [0, 1, 2],
      "the replayed initialize must not reach the conversation"
    );
    assert.deepEqual((written[2].result as Message).ok, "tools/call");
    assert.deepEqual(fake.state.initializeIds, [0, "bridge-relay-reinit-1"]);
    assert.equal(ensured, 1, "recovery checks the server is up before re-initializing");
  } finally {
    relay.close();
    fake.close();
  }
});

test("relay answers a request with an error when the server stays unreachable", async () => {
  const written: Message[] = [];
  const relay = new Relay({
    url: "http://127.0.0.1:9/mcp", // discard port: nothing listens
    write: (msg) => written.push(msg),
    ensureServer: async () => {},
    log: () => {},
  });
  await relay.handle({ jsonrpc: "2.0", id: 5, method: "initialize", params: {} });
  assert.equal(written.length, 1);
  assert.equal(written[0].id, 5);
  assert.ok(written[0].error, "the conversation gets an error instead of waiting forever");
});

test("simultaneous relays start the shared server once", async () => {
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
  await Promise.all([ensureServer(ctl, () => {}, 5_000), ensureServer(ctl, () => {}, 5_000)]);
  assert.equal(starts, 1);
  assert.equal(fs.existsSync(lockPath), false, "the lock is released once the server answers");
});

test("a lock left by a dead relay is reclaimed", () => {
  const lockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bridge-relay-")), "start.lock");
  fs.writeFileSync(lockPath, "999999999"); // no such process
  assert.equal(takeLock(lockPath), true);
  assert.equal(takeLock(lockPath), false, "a lock held by a live process is honoured");
});
