"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const codegen_js_1 = require("./codegen.js");
const helpers_js_1 = require("./helpers.js");
function singleChunk() {
    return {
        label: "build",
        index: 0,
        nodes: [],
        imports: { variables: [], components: [], textStyles: [] },
    };
}
(0, node_test_1.test)("root frame is placed in clear space, not hardcoded at (0,0)", () => {
    const code = (0, codegen_js_1.generateCode)(singleChunk(), {
        rootName: "Screen",
        rootWidth: 1440,
        rootHeight: 900,
    });
    strict_1.default.ok(code.includes("figma.currentPage.children"), "expected a scan over figma.currentPage.children for placement");
    strict_1.default.ok(!/root\.x\s*=\s*0\s*;/.test(code), "root.x must be computed, not hardcoded to 0");
    strict_1.default.ok(code.includes("figma.currentPage.appendChild(root)"));
});
// Reconstruct the runtime findPropKey from the injected helper block so we can
// test its matching behavior directly.
function loadFindPropKey() {
    return new Function(helpers_js_1.HELPER_BLOCK + "\nreturn findPropKey;")();
}
(0, node_test_1.test)("findPropKey matches exact name segment, not a shared prefix", () => {
    const findPropKey = loadFindPropKey();
    const compSet = {
        componentPropertyDefinitions: {
            "Label secondary#3:4": { type: "TEXT" },
            "Label#1:2": { type: "TEXT" },
            Size: { type: "VARIANT" },
        },
    };
    strict_1.default.equal(findPropKey(compSet, "Label", "TEXT"), "Label#1:2");
    strict_1.default.equal(findPropKey(compSet, "Size", "VARIANT"), "Size");
    strict_1.default.equal(findPropKey(compSet, "Nope", "TEXT"), undefined);
});
(0, node_test_1.test)("multiple imports are batched into a single importAll call", () => {
    const chunk = {
        label: "build",
        index: 0,
        nodes: [],
        imports: {
            variables: [
                { kind: "variable", key: "VariableID:1:1", name: "color/bg", ref: "$color/bg" },
                { kind: "variable", key: "VariableID:1:2", name: "spacing/md", ref: "$spacing/md" },
            ],
            components: [{ kind: "component", key: "comp-button", name: "Button", ref: "$comp/Button" }],
            textStyles: [],
        },
    };
    const code = (0, codegen_js_1.generateCode)(chunk, { rootName: "S", rootWidth: 100, rootHeight: 100 });
    const calls = code.match(/await importAll\(\[/g) ?? [];
    strict_1.default.equal(calls.length, 1, "imports must be batched into one importAll call");
    strict_1.default.ok(code.includes("function importAll("), "the chunk must carry the importAll helper");
    strict_1.default.ok(code.includes(", " + helpers_js_1.IMPORT_TIMEOUT_MS + ");"), "importAll must receive the per-import timeout");
    strict_1.default.ok(code.includes('["importVariableByKeyAsync","VariableID:1:1","color/bg"]'), "each entry carries method, key and name");
});
(0, node_test_1.test)("a chunk without imports does not carry the import helper", () => {
    const code = (0, codegen_js_1.generateCode)(singleChunk(), { rootName: "S", rootWidth: 100, rootHeight: 100 });
    strict_1.default.ok(!code.includes("importAll"));
});
(0, node_test_1.test)("a single import still compiles correctly", () => {
    const chunk = {
        label: "build",
        index: 0,
        nodes: [],
        imports: {
            variables: [{ kind: "variable", key: "VariableID:1:1", name: "color/bg", ref: "$color/bg" }],
            components: [],
            textStyles: [],
        },
    };
    const code = (0, codegen_js_1.generateCode)(chunk, { rootName: "S", rootWidth: 100, rootHeight: 100 });
    strict_1.default.ok(code.includes("importVariableByKeyAsync"));
});
(0, node_test_1.test)("multi-chunk preload destructures the same import names it stores on globalThis", () => {
    // ── FIXTURE ──────────────────────────────────────────────────────────────────
    // Build a preload chunk with: 2 variables + 1 component + 1 textStyle
    const imports = {
        variables: [
            {
                kind: "variable",
                key: "VariableID:10:1",
                name: "color/bg/default",
                ref: "$color/bg/default",
                importMethod: null,
            },
            {
                kind: "variable",
                key: "VariableID:10:2",
                name: "spacing/md",
                ref: "$spacing/md",
                importMethod: null,
            },
        ],
        components: [
            {
                kind: "component",
                key: "comp-button-key",
                name: "Button",
                ref: "$comp/Button",
                importMethod: null,
            },
        ],
        textStyles: [
            {
                kind: "textStyle",
                key: "style-heading-xl",
                name: "heading/xl",
                ref: "$text/heading/xl",
                importMethod: null,
            },
        ],
    };
    const preloadChunk = {
        label: "preload",
        index: 0,
        nodes: [],
        imports,
        bridgeExports: [],
        bridgeImports: [],
    };
    // ── PRELOAD CODE ──────────────────────────────────────────────────────────────
    const preloadCode = (0, codegen_js_1.generateCode)(preloadChunk, {
        isMultiChunk: true,
        rootName: "S",
        rootWidth: 100,
        rootHeight: 100,
    });
    // ── EXTRACT DESTRUCTURED NAMES ────────────────────────────────────────────────
    // Match: var [name1, name2, ...] = await importAll([
    const destructureMatch = preloadCode.match(/var\s+\[([^\]]+)\]\s*=\s*await\s+importAll/);
    strict_1.default.ok(destructureMatch, "expected a destructuring assignment from importAll");
    const destructuredNames = new Set(destructureMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean));
    // ── EXTRACT globalThis.__bridge.<name> = <name> ENTRIES ──────────────────────
    // Match every line of the form: globalThis.__bridge.<name> = <name>;
    // We exclude `root` which is always added separately and is not in the importAll destructuring.
    const bridgeStoreRegex = /globalThis\.__bridge\.(\w+)\s*=\s*\1\s*;/g;
    const bridgeStoredNames = new Set();
    let m;
    while ((m = bridgeStoreRegex.exec(preloadCode)) !== null) {
        bridgeStoredNames.add(m[1]);
    }
    // Exclude `root` — it is stored on globalThis.__bridge separately (after frame creation),
    // not from the destructuring.
    bridgeStoredNames.delete("root");
    strict_1.default.ok(bridgeStoredNames.size > 0, "expected at least one non-root name stored on globalThis.__bridge");
    // ── INVARIANT: every stored name must appear in the destructuring ─────────────
    // This guards against order drift between emitImports() (which fills pairs[]) and
    // the forEach that stores on globalThis.__bridge (which iterates importNames Map).
    // If those two iterations ever diverge — e.g. different key sets — bridgeStoredNames
    // would contain a name absent from destructuredNames and the assertion below fails.
    for (const name of bridgeStoredNames) {
        strict_1.default.ok(destructuredNames.has(name), `globalThis.__bridge.${name} is stored but "${name}" is not in the importAll destructuring`);
    }
    // ── BUILD CHUNK ───────────────────────────────────────────────────────────────
    // Build chunks reconstruct var <name> = b.<name>; from context.allImports.
    const buildChunk = {
        label: "build-1",
        index: 1,
        nodes: [],
        imports: { variables: [], components: [], textStyles: [] },
        bridgeExports: [],
        bridgeImports: [],
    };
    const buildCode = (0, codegen_js_1.generateCode)(buildChunk, {
        isMultiChunk: true,
        allImports: imports,
        rootName: "S",
        rootWidth: 100,
        rootHeight: 100,
    });
    // ── EXTRACT RECONSTRUCTED NAMES ───────────────────────────────────────────────
    // Match every line: var <name> = b.<name>;
    const reconstructRegex = /var\s+(\w+)\s*=\s*b\.\1\s*;/g;
    const reconstructedNames = new Set();
    while ((m = reconstructRegex.exec(buildCode)) !== null) {
        reconstructedNames.add(m[1]);
    }
    // `root` is always reconstructed from b.root via a dedicated line ("var root = b.root;"),
    // not via allImports — mirror the same exclusion applied to bridgeStoredNames above.
    reconstructedNames.delete("root");
    strict_1.default.ok(reconstructedNames.size > 0, "expected at least one reconstructed import in build chunk");
    // ── INVARIANT: every reconstructed name must have appeared in preload destructuring ──
    // This guards the contract between emitBuildChunk (which calls importVarName on
    // context.allImports) and emitPreloadChunk (which calls importVarName on chunk.imports
    // via emitImports). Both must produce the same names for the same ImportEntry objects.
    for (const name of reconstructedNames) {
        strict_1.default.ok(destructuredNames.has(name), `build chunk uses "b.${name}" but "${name}" was not in preload destructuring`);
    }
    // Symmetry: preload destructured names (which exclude root) must equal reconstructed names
    strict_1.default.deepEqual([...destructuredNames].sort(), [...reconstructedNames].sort(), "preload destructuring and build reconstruction must cover the exact same import names");
});
function stubFigma(behaviour) {
    const calls = [];
    const nodes = {};
    const importByKey = (key) => {
        calls.push(key);
        const b = behaviour[key] ?? "ok";
        if (b === "hang")
            return new Promise(() => { });
        if (b === "fail")
            return Promise.reject(new Error("not published"));
        nodes[key] = { key, removed: false };
        return Promise.resolve(nodes[key]);
    };
    const figma = {
        variables: { importVariableByKeyAsync: importByKey },
        importComponentSetByKeyAsync: importByKey,
        importStyleByKeyAsync: importByKey,
    };
    const importAll = new Function("figma", helpers_js_1.IMPORT_HELPER + "\nreturn importAll;")(figma);
    return { calls, nodes, importAll };
}
function resetImportCache() {
    delete globalThis.__bridgeImports;
}
(0, node_test_1.test)("importAll resolves every import in order", async () => {
    resetImportCache();
    const { importAll } = stubFigma({});
    const values = (await importAll([
        ["importVariableByKeyAsync", "v1", "color/bg"],
        ["importComponentSetByKeyAsync", "c1", "Button"],
    ], 1000));
    strict_1.default.deepEqual(values.map((v) => v.key), ["v1", "c1"]);
    resetImportCache();
});
(0, node_test_1.test)("a stuck import fails with its key and name, and a retry reuses it", async () => {
    resetImportCache();
    const { calls, importAll } = stubFigma({ c1: "hang" });
    const list = [
        ["importVariableByKeyAsync", "v1", "color/bg"],
        ["importComponentSetByKeyAsync", "c1", "Button"],
    ];
    await strict_1.default.rejects(importAll(list, 20), (err) => {
        strict_1.default.match(err.message, /1 of 2 library imports failed/);
        strict_1.default.match(err.message, /importComponentSetByKeyAsync c1 \(Button\): no answer/);
        strict_1.default.match(err.message, /Close and reopen the Desktop Bridge plugin/);
        return true;
    });
    // The retry must wait on the pending import, not start a second one.
    await strict_1.default.rejects(importAll(list, 20));
    strict_1.default.deepEqual(calls, ["v1", "c1"], "neither import may be started twice");
    resetImportCache();
});
(0, node_test_1.test)("a rejected import is reported with Figma's error and retried afresh", async () => {
    resetImportCache();
    const { calls, importAll } = stubFigma({ s1: "fail" });
    const list = [["importStyleByKeyAsync", "s1", "heading/xl"]];
    await strict_1.default.rejects(importAll(list, 1000), (err) => {
        strict_1.default.match(err.message, /importStyleByKeyAsync s1 \(heading\/xl\): not published/);
        strict_1.default.doesNotMatch(err.message, /reopen/, "a plain failure is not a stuck plugin");
        return true;
    });
    await strict_1.default.rejects(importAll(list, 1000));
    strict_1.default.deepEqual(calls, ["s1", "s1"], "a failed import must be evicted from the cache");
    resetImportCache();
});
(0, node_test_1.test)("a cached node removed since is imported again", async () => {
    resetImportCache();
    const { calls, nodes, importAll } = stubFigma({});
    const list = [["importComponentSetByKeyAsync", "c1", "Button"]];
    await importAll(list, 1000);
    await importAll(list, 1000);
    strict_1.default.deepEqual(calls, ["c1"], "a live cached node is reused");
    nodes["c1"].removed = true;
    await importAll(list, 1000);
    strict_1.default.deepEqual(calls, ["c1", "c1"], "a removed node is re-imported");
    resetImportCache();
});
//# sourceMappingURL=codegen.test.js.map