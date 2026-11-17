// Regression tests for the compile pipeline.
// Build a minimal on-disk KB in a temp dir, then exercise the three
// top-level outcomes: success, resolve error, transport misuse.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { compile } from "./compile.js";
import type { CompileOptions } from "./compile.js";
import { IMPORT_TIMEOUT_MS } from "./helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TempKb {
  kbPath: string;
  cleanup(): void;
}

function writeTempKb(): TempKb {
  const root = mkdtempSync(path.join(os.tmpdir(), "bridge-compile-test-"));
  const regs = path.join(root, "knowledge-base", "registries");
  mkdirSync(regs, { recursive: true });

  writeFileSync(
    path.join(regs, "variables.json"),
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      variables: [
        {
          name: "color/bg/primary",
          key: "VariableID:1:1",
          resolvedType: "COLOR",
          valuesByMode: {},
        },
        { name: "spacing/md", key: "VariableID:1:2", resolvedType: "FLOAT", valuesByMode: {} },
        { name: "radius/md", key: "VariableID:1:3", resolvedType: "FLOAT", valuesByMode: {} },
      ],
    })
  );

  writeFileSync(
    path.join(regs, "components.json"),
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      components: [
        {
          name: "Button",
          key: "comp-button-key-0001",
          category: "actions",
          status: "stable",
          variants: [],
          properties: [],
        },
      ],
    })
  );

  writeFileSync(
    path.join(regs, "text-styles.json"),
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      styles: [
        {
          name: "text/label/md",
          key: "TextStyle:42",
          fontFamily: "Inter",
          fontStyle: "Regular",
          fontSize: 14,
        },
      ],
    })
  );

  return {
    kbPath: root,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function validSceneGraph(): object {
  return {
    version: "3.0",
    metadata: { name: "TestRoot", width: 800, height: 600 },
    fonts: [{ family: "Inter", style: "Regular" }],
    nodes: [
      {
        type: "FRAME",
        name: "Card",
        layout: "VERTICAL",
        primaryAxisSizing: "AUTO",
        counterAxisSizing: "FIXED",
        width: 400,
        height: 200,
        fill: "$color/bg/primary",
        padding: "$spacing/md",
        radius: "$radius/md",
        children: [
          {
            type: "TEXT",
            name: "Title",
            characters: "Hello",
            textStyle: "$text/label/md",
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("compile() returns success for a valid scene graph", () => {
  const kb = writeTempKb();
  try {
    const result = compile({
      input: validSceneGraph(),
      kbPath: kb.kbPath,
      transport: "console",
    });

    assert.equal(result.success, true, JSON.stringify(result.errors));
    assert.equal(result.errors.length, 0);
    assert.ok(result.chunks.length >= 1);
    assert.ok(result.chunks[0]!.code.length > 0);
    assert.equal(typeof result.chunks[0]!.id, "string");
    assert.ok(result.plan);
    assert.equal(result.plan!.totalChunks, result.chunks.length);
    const allCode = result.chunks.map((c) => c.code).join("\n");
    assert.ok(
      allCode.includes("figma.currentPage.children"),
      "compiled output must scan for clear space"
    );
  } finally {
    kb.cleanup();
  }
});

test("compile() reports RESOLVE_TOKEN_NOT_FOUND for an unknown token", () => {
  const kb = writeTempKb();
  try {
    const graph = validSceneGraph() as { nodes: Array<{ fill?: string }> };
    graph.nodes[0]!.fill = "$color/bg/does-not-exist";

    const result = compile({
      input: graph,
      kbPath: kb.kbPath,
      transport: "console",
    });

    assert.equal(result.success, false);
    assert.ok(result.errors.length > 0);
    const codes = result.errors.map((e) => e.code);
    assert.ok(
      codes.includes("RESOLVE_TOKEN_NOT_FOUND"),
      "expected RESOLVE_TOKEN_NOT_FOUND in " + codes.join(",")
    );
    assert.equal(result.chunks.length, 0);
    assert.equal(result.plan, null);
  } finally {
    kb.cleanup();
  }
});

test("compile() rejects the official transport without a fileKey", () => {
  const kb = writeTempKb();
  try {
    const result = compile({
      input: validSceneGraph(),
      kbPath: kb.kbPath,
      // Force official transport, but omit fileKey — wrap.ts should throw
      // WRAP_MISSING_FILEKEY which compile() catches and reports as an error.
      transport: "official",
      fileKey: null,
    } as CompileOptions);

    assert.equal(result.success, false);
    const codes = result.errors.map((e) => e.code);
    assert.ok(
      codes.includes("WRAP_MISSING_FILEKEY"),
      "expected WRAP_MISSING_FILEKEY in " + codes.join(",")
    );
    assert.equal(result.chunks.length, 0);
  } finally {
    kb.cleanup();
  }
});

test("compile() reports PARSE_INVALID_JSON for malformed input strings", () => {
  const kb = writeTempKb();
  try {
    const result = compile({
      input: "{not valid json",
      kbPath: kb.kbPath,
    });
    assert.equal(result.success, false);
    assert.equal(result.errors[0]?.code, "PARSE_INVALID_JSON");
  } finally {
    kb.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Deep overrides on INSTANCE nodes
//
// A DS component only exposes what its master declares. A table's cells and a
// rail's items are nested layers, so without these the agent's only options
// were to detach the component or rebuild it out of atoms — both of which cut
// the screen off from the design system.
// ---------------------------------------------------------------------------

function instanceGraph(overrides: unknown): object {
  return {
    version: "3.0",
    metadata: { name: "TestRoot", width: 800, height: 600 },
    fonts: [{ family: "Inter", style: "Regular" }],
    nodes: [
      {
        type: "FRAME",
        name: "Card",
        layout: "VERTICAL",
        primaryAxisSizing: "AUTO",
        counterAxisSizing: "FIXED",
        width: 400,
        height: 200,
        children: [{ type: "INSTANCE", name: "Cta", component: "Button", overrides }],
      },
    ],
  };
}

test("INSTANCE overrides reach a nested layer the component does not expose", () => {
  const kb = writeTempKb();
  try {
    const result = compile({
      input: instanceGraph([
        { find: { name: "Label", type: "TEXT" }, set: { characters: "Envoyer" } },
      ]),
      kbPath: kb.kbPath,
      transport: "console",
    });

    assert.equal(result.success, true, JSON.stringify(result.errors));
    const code = result.chunks.map((c) => c.code).join("\n");
    assert.ok(code.includes('.findOne(function(n) { return n.name === "Label"'), code);
    assert.ok(code.includes("await setChars("), "text must go through the font-loading helper");
    assert.ok(code.includes('"Envoyer"'), code);
  } finally {
    kb.cleanup();
  }
});

test("find.nth targets the Nth match — repeated layer names are the norm in a DS", () => {
  const kb = writeTempKb();
  try {
    const result = compile({
      input: instanceGraph([
        { find: { name: "am-table-cell-value", nth: 2 }, set: { characters: "Cambrai" } },
      ]),
      kbPath: kb.kbPath,
      transport: "console",
    });

    assert.equal(result.success, true, JSON.stringify(result.errors));
    const code = result.chunks.map((c) => c.code).join("\n");
    assert.ok(code.includes(".findAll("), "nth must enumerate, not take the first hit");
    assert.ok(/\[2\] \|\| null/.test(code), code);
    assert.ok(!code.includes(".findOne("), "findOne would silently write to cell 0");
  } finally {
    kb.cleanup();
  }
});

test("an override fill is resolved and imported like any other token", () => {
  const kb = writeTempKb();
  try {
    const result = compile({
      input: instanceGraph([{ find: { name: "Bg" }, set: { fill: "$color/bg/primary" } }]),
      kbPath: kb.kbPath,
      transport: "console",
    });

    assert.equal(result.success, true, JSON.stringify(result.errors));
    const code = result.chunks.map((c) => c.code).join("\n");
    assert.ok(code.includes("VariableID:1:1"), "the variable must be imported by the chunk");
    assert.ok(code.includes(".fills = mf("), code);
  } finally {
    kb.cleanup();
  }
});

test("an unknown token in an override fails the compile instead of vanishing", () => {
  const kb = writeTempKb();
  try {
    const result = compile({
      input: instanceGraph([{ find: { name: "Bg" }, set: { fill: "$color/bg/does-not-exist" } }]),
      kbPath: kb.kbPath,
      transport: "console",
    });

    assert.equal(result.success, false);
    const codes = result.errors.map((e) => e.code);
    assert.ok(codes.includes("RESOLVE_TOKEN_NOT_FOUND"), codes.join(","));
  } finally {
    kb.cleanup();
  }
});

test("find.nth must be a non-negative integer", () => {
  const kb = writeTempKb();
  try {
    const result = compile({
      input: instanceGraph([{ find: { name: "Cell", nth: -1 }, set: { characters: "x" } }]),
      kbPath: kb.kbPath,
      transport: "console",
    });

    assert.equal(result.success, false);
    assert.ok(
      result.errors.some((e) => String(e.path ?? "").endsWith("find.nth")),
      JSON.stringify(result.errors)
    );
  } finally {
    kb.cleanup();
  }
});

test("every chunk declares a timeout longer than one library import, and parses", () => {
  const kb = writeTempKb();
  try {
    const result = compile({ input: validSceneGraph(), kbPath: kb.kbPath, transport: "console" });
    assert.equal(result.success, true, JSON.stringify(result.errors));
    for (const chunk of result.chunks) {
      assert.ok(
        chunk.timeoutMs > IMPORT_TIMEOUT_MS,
        "chunk " + chunk.id + " must outlast one import, so the import error arrives first"
      );
      assert.doesNotThrow(() => new Function("figma", chunk.code), "chunk " + chunk.id);
    }
  } finally {
    kb.cleanup();
  }
});

test("a compiled chunk reports a stuck library import by key and name", async () => {
  const kb = writeTempKb();
  try {
    const result = compile({ input: validSceneGraph(), kbPath: kb.kbPath, transport: "console" });
    assert.equal(result.success, true, JSON.stringify(result.errors));
    const chunk = result.chunks[0]!;

    // Shorten the per-import timeout so the test does not wait 30 s.
    const marker = "], " + IMPORT_TIMEOUT_MS + ");";
    assert.ok(chunk.code.includes(marker), "the chunk passes IMPORT_TIMEOUT_MS to importAll");
    const code = chunk.code.replace(marker, "], 20);");

    const hang = (): Promise<never> => new Promise(() => {});
    const figma = {
      loadFontAsync: () => Promise.resolve(),
      variables: { importVariableByKeyAsync: hang },
      importComponentByKeyAsync: hang,
      importStyleByKeyAsync: hang,
    };
    const run = new Function("figma", code) as (f: unknown) => Promise<unknown>;

    await assert.rejects(run(figma), (err: Error) => {
      assert.match(err.message, /library imports failed/);
      assert.match(err.message, /VariableID:1:1 \(color\/bg\/primary\): no answer/);
      assert.match(err.message, /Close and reopen the Desktop Bridge plugin/);
      return true;
    });
  } finally {
    kb.cleanup();
    delete (globalThis as { __bridgeImports?: unknown }).__bridgeImports;
  }
});
