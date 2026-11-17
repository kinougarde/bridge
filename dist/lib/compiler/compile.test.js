"use strict";
// Regression tests for the compile pipeline.
// Build a minimal on-disk KB in a temp dir, then exercise the three
// top-level outcomes: success, resolve error, transport misuse.
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
const node_fs_1 = require("node:fs");
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const compile_js_1 = require("./compile.js");
const helpers_js_1 = require("./helpers.js");
function writeTempKb() {
    const root = (0, node_fs_1.mkdtempSync)(path.join(os.tmpdir(), "bridge-compile-test-"));
    const regs = path.join(root, "knowledge-base", "registries");
    (0, node_fs_1.mkdirSync)(regs, { recursive: true });
    (0, node_fs_1.writeFileSync)(path.join(regs, "variables.json"), JSON.stringify({
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
    }));
    (0, node_fs_1.writeFileSync)(path.join(regs, "components.json"), JSON.stringify({
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
    }));
    (0, node_fs_1.writeFileSync)(path.join(regs, "text-styles.json"), JSON.stringify({
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
    }));
    return {
        kbPath: root,
        cleanup() {
            (0, node_fs_1.rmSync)(root, { recursive: true, force: true });
        },
    };
}
function validSceneGraph() {
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
(0, node_test_1.test)("compile() returns success for a valid scene graph", () => {
    const kb = writeTempKb();
    try {
        const result = (0, compile_js_1.compile)({
            input: validSceneGraph(),
            kbPath: kb.kbPath,
            transport: "console",
        });
        strict_1.default.equal(result.success, true, JSON.stringify(result.errors));
        strict_1.default.equal(result.errors.length, 0);
        strict_1.default.ok(result.chunks.length >= 1);
        strict_1.default.ok(result.chunks[0].code.length > 0);
        strict_1.default.equal(typeof result.chunks[0].id, "string");
        strict_1.default.ok(result.plan);
        strict_1.default.equal(result.plan.totalChunks, result.chunks.length);
        const allCode = result.chunks.map((c) => c.code).join("\n");
        strict_1.default.ok(allCode.includes("figma.currentPage.children"), "compiled output must scan for clear space");
    }
    finally {
        kb.cleanup();
    }
});
(0, node_test_1.test)("compile() reports RESOLVE_TOKEN_NOT_FOUND for an unknown token", () => {
    const kb = writeTempKb();
    try {
        const graph = validSceneGraph();
        graph.nodes[0].fill = "$color/bg/does-not-exist";
        const result = (0, compile_js_1.compile)({
            input: graph,
            kbPath: kb.kbPath,
            transport: "console",
        });
        strict_1.default.equal(result.success, false);
        strict_1.default.ok(result.errors.length > 0);
        const codes = result.errors.map((e) => e.code);
        strict_1.default.ok(codes.includes("RESOLVE_TOKEN_NOT_FOUND"), "expected RESOLVE_TOKEN_NOT_FOUND in " + codes.join(","));
        strict_1.default.equal(result.chunks.length, 0);
        strict_1.default.equal(result.plan, null);
    }
    finally {
        kb.cleanup();
    }
});
(0, node_test_1.test)("compile() rejects the official transport without a fileKey", () => {
    const kb = writeTempKb();
    try {
        const result = (0, compile_js_1.compile)({
            input: validSceneGraph(),
            kbPath: kb.kbPath,
            // Force official transport, but omit fileKey — wrap.ts should throw
            // WRAP_MISSING_FILEKEY which compile() catches and reports as an error.
            transport: "official",
            fileKey: null,
        });
        strict_1.default.equal(result.success, false);
        const codes = result.errors.map((e) => e.code);
        strict_1.default.ok(codes.includes("WRAP_MISSING_FILEKEY"), "expected WRAP_MISSING_FILEKEY in " + codes.join(","));
        strict_1.default.equal(result.chunks.length, 0);
    }
    finally {
        kb.cleanup();
    }
});
(0, node_test_1.test)("compile() reports PARSE_INVALID_JSON for malformed input strings", () => {
    const kb = writeTempKb();
    try {
        const result = (0, compile_js_1.compile)({
            input: "{not valid json",
            kbPath: kb.kbPath,
        });
        strict_1.default.equal(result.success, false);
        strict_1.default.equal(result.errors[0]?.code, "PARSE_INVALID_JSON");
    }
    finally {
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
function instanceGraph(overrides) {
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
(0, node_test_1.test)("INSTANCE overrides reach a nested layer the component does not expose", () => {
    const kb = writeTempKb();
    try {
        const result = (0, compile_js_1.compile)({
            input: instanceGraph([
                { find: { name: "Label", type: "TEXT" }, set: { characters: "Envoyer" } },
            ]),
            kbPath: kb.kbPath,
            transport: "console",
        });
        strict_1.default.equal(result.success, true, JSON.stringify(result.errors));
        const code = result.chunks.map((c) => c.code).join("\n");
        strict_1.default.ok(code.includes('.findOne(function(n) { return n.name === "Label"'), code);
        strict_1.default.ok(code.includes("await setChars("), "text must go through the font-loading helper");
        strict_1.default.ok(code.includes('"Envoyer"'), code);
    }
    finally {
        kb.cleanup();
    }
});
(0, node_test_1.test)("find.nth targets the Nth match — repeated layer names are the norm in a DS", () => {
    const kb = writeTempKb();
    try {
        const result = (0, compile_js_1.compile)({
            input: instanceGraph([
                { find: { name: "am-table-cell-value", nth: 2 }, set: { characters: "Cambrai" } },
            ]),
            kbPath: kb.kbPath,
            transport: "console",
        });
        strict_1.default.equal(result.success, true, JSON.stringify(result.errors));
        const code = result.chunks.map((c) => c.code).join("\n");
        strict_1.default.ok(code.includes(".findAll("), "nth must enumerate, not take the first hit");
        strict_1.default.ok(/\[2\] \|\| null/.test(code), code);
        strict_1.default.ok(!code.includes(".findOne("), "findOne would silently write to cell 0");
    }
    finally {
        kb.cleanup();
    }
});
(0, node_test_1.test)("an override fill is resolved and imported like any other token", () => {
    const kb = writeTempKb();
    try {
        const result = (0, compile_js_1.compile)({
            input: instanceGraph([{ find: { name: "Bg" }, set: { fill: "$color/bg/primary" } }]),
            kbPath: kb.kbPath,
            transport: "console",
        });
        strict_1.default.equal(result.success, true, JSON.stringify(result.errors));
        const code = result.chunks.map((c) => c.code).join("\n");
        strict_1.default.ok(code.includes("VariableID:1:1"), "the variable must be imported by the chunk");
        strict_1.default.ok(code.includes(".fills = mf("), code);
    }
    finally {
        kb.cleanup();
    }
});
(0, node_test_1.test)("an unknown token in an override fails the compile instead of vanishing", () => {
    const kb = writeTempKb();
    try {
        const result = (0, compile_js_1.compile)({
            input: instanceGraph([{ find: { name: "Bg" }, set: { fill: "$color/bg/does-not-exist" } }]),
            kbPath: kb.kbPath,
            transport: "console",
        });
        strict_1.default.equal(result.success, false);
        const codes = result.errors.map((e) => e.code);
        strict_1.default.ok(codes.includes("RESOLVE_TOKEN_NOT_FOUND"), codes.join(","));
    }
    finally {
        kb.cleanup();
    }
});
(0, node_test_1.test)("find.nth must be a non-negative integer", () => {
    const kb = writeTempKb();
    try {
        const result = (0, compile_js_1.compile)({
            input: instanceGraph([{ find: { name: "Cell", nth: -1 }, set: { characters: "x" } }]),
            kbPath: kb.kbPath,
            transport: "console",
        });
        strict_1.default.equal(result.success, false);
        strict_1.default.ok(result.errors.some((e) => String(e.path ?? "").endsWith("find.nth")), JSON.stringify(result.errors));
    }
    finally {
        kb.cleanup();
    }
});
(0, node_test_1.test)("every chunk declares a timeout longer than one library import, and parses", () => {
    const kb = writeTempKb();
    try {
        const result = (0, compile_js_1.compile)({ input: validSceneGraph(), kbPath: kb.kbPath, transport: "console" });
        strict_1.default.equal(result.success, true, JSON.stringify(result.errors));
        for (const chunk of result.chunks) {
            strict_1.default.ok(chunk.timeoutMs > helpers_js_1.IMPORT_TIMEOUT_MS, "chunk " + chunk.id + " must outlast one import, so the import error arrives first");
            strict_1.default.doesNotThrow(() => new Function("figma", chunk.code), "chunk " + chunk.id);
        }
    }
    finally {
        kb.cleanup();
    }
});
(0, node_test_1.test)("a compiled chunk reports a stuck library import by key and name", async () => {
    const kb = writeTempKb();
    try {
        const result = (0, compile_js_1.compile)({ input: validSceneGraph(), kbPath: kb.kbPath, transport: "console" });
        strict_1.default.equal(result.success, true, JSON.stringify(result.errors));
        const chunk = result.chunks[0];
        // Shorten the per-import timeout so the test does not wait 30 s.
        const marker = "], " + helpers_js_1.IMPORT_TIMEOUT_MS + ");";
        strict_1.default.ok(chunk.code.includes(marker), "the chunk passes IMPORT_TIMEOUT_MS to importAll");
        const code = chunk.code.replace(marker, "], 20);");
        const hang = () => new Promise(() => { });
        const figma = {
            loadFontAsync: () => Promise.resolve(),
            variables: { importVariableByKeyAsync: hang },
            importComponentByKeyAsync: hang,
            importStyleByKeyAsync: hang,
        };
        const run = new Function("figma", code);
        await strict_1.default.rejects(run(figma), (err) => {
            strict_1.default.match(err.message, /library imports failed/);
            strict_1.default.match(err.message, /VariableID:1:1 \(color\/bg\/primary\): no answer/);
            strict_1.default.match(err.message, /Close and reopen the Desktop Bridge plugin/);
            return true;
        });
    }
    finally {
        kb.cleanup();
        delete globalThis.__bridgeImports;
    }
});
//# sourceMappingURL=compile.test.js.map