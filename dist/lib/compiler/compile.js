"use strict";
// ---------------------------------------------------------------------------
// compile.ts — pipeline orchestrator (programmatic entry point)
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.compile = compile;
const schema_js_1 = require("./schema.js");
const registry_js_1 = require("./registry.js");
const resolve_js_1 = require("./resolve.js");
const validate_js_1 = require("./validate.js");
const plan_js_1 = require("./plan.js");
const codegen_js_1 = require("./codegen.js");
const helpers_js_1 = require("./helpers.js");
const wrap_js_1 = require("./wrap.js");
const errors_js_1 = require("./errors.js");
const compile_bridge_js_1 = require("../lint/compile-bridge.js");
function compile(optionsOrSpec, maybeOpts) {
    // Spec-first overload: second positional argument is present.
    if (maybeOpts !== undefined) {
        return compileWithLint(optionsOrSpec, maybeOpts);
    }
    return compileLegacy(optionsOrSpec);
}
/**
 * Spec-first compile path: runs compile-time lint rules against a raw
 * CSpec doc and short-circuits on any `severity: error` violation. When no
 * lint config is configured (or the path doesn't exist) this is a no-op
 * that preserves v6 behaviour.
 *
 * Scene-graph emission for the CSpec is intentionally not invoked here:
 * Task 16 wires lint as a hard gate; downstream scene-graph emission will
 * be wired in a follow-up once the CSpec → scene-graph compiler exists.
 */
async function compileWithLint(spec, opts) {
    if (opts.lintConfigPath) {
        const lintResult = await (0, compile_bridge_js_1.runLintAtCompileTime)(spec, opts.lintConfigPath);
        const blocking = lintResult.diagnostics.filter((d) => d.severity === "error");
        if (blocking.length > 0) {
            return { ok: false, errors: blocking.slice(), sceneGraph: null };
        }
    }
    return { ok: true, errors: [], sceneGraph: null };
}
function compileLegacy(options) {
    const opts = options ?? {};
    const transport = opts.transport ?? "console";
    const fileKey = opts.fileKey ?? null;
    const verbose = opts.verbose ?? false;
    // ── Stage 1: Parse + schema validation ────────────────────────────────────
    let json;
    if (typeof opts.input === "string") {
        try {
            json = JSON.parse(opts.input);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
                success: false,
                errors: [
                    new errors_js_1.CompilerError("PARSE_INVALID_JSON", {
                        message: "Failed to parse input JSON: " + msg,
                    }),
                ],
                warnings: [],
                chunks: [],
                plan: null,
            };
        }
    }
    else if (opts.input && typeof opts.input === "object") {
        json = opts.input;
    }
    else {
        return {
            success: false,
            errors: [
                new errors_js_1.CompilerError("PARSE_INVALID_JSON", {
                    message: "Input must be a JSON string or object",
                }),
            ],
            warnings: [],
            chunks: [],
            plan: null,
        };
    }
    const schemaResult = (0, schema_js_1.validateSceneGraph)(json);
    if (!schemaResult.valid || !schemaResult.graph) {
        return {
            success: false,
            errors: schemaResult.errors,
            warnings: [],
            chunks: [],
            plan: null,
        };
    }
    const graph = schemaResult.graph;
    // ── Stage 2: Load registry ────────────────────────────────────────────────
    const registry = (0, registry_js_1.loadRegistry)(opts.kbPath);
    // ── Stage 3: Resolve ──────────────────────────────────────────────────────
    const resolveResult = (0, resolve_js_1.resolve)(graph, registry);
    if (verbose) {
        const imp = resolveResult.imports;
        const vCount = imp.variables?.length ?? 0;
        const cCount = imp.components?.length ?? 0;
        const sCount = imp.textStyles?.length ?? 0;
        const fCount = imp.fonts?.length ?? 0;
        process.stderr.write("[resolve] variables=" +
            vCount +
            " components=" +
            cCount +
            " styles=" +
            sCount +
            " fonts=" +
            fCount +
            "\n");
    }
    if (resolveResult.errors.length > 0) {
        return {
            success: false,
            errors: resolveResult.errors,
            warnings: resolveResult.warnings,
            chunks: [],
            plan: null,
        };
    }
    const resolvedGraph = resolveResult.graph;
    const imports = resolveResult.imports;
    const allWarnings = resolveResult.warnings.slice();
    // ── Stage 4: Validate ─────────────────────────────────────────────────────
    const validateResult = (0, validate_js_1.validate)(resolvedGraph, registry);
    if (validateResult.warnings.length > 0) {
        for (const w of validateResult.warnings)
            allWarnings.push(w);
    }
    if (validateResult.errors.length > 0) {
        return {
            success: false,
            errors: validateResult.errors,
            warnings: allWarnings,
            chunks: [],
            plan: null,
        };
    }
    // ── Stage 5: Plan ─────────────────────────────────────────────────────────
    const execPlan = (0, plan_js_1.plan)(resolvedGraph, imports, { transport });
    const isMultiChunk = execPlan.chunks.length > 1;
    if (verbose) {
        process.stderr.write("[plan] chunks=" +
            execPlan.chunks.length +
            " totalImports=" +
            execPlan.totalImports +
            " estimatedSize=" +
            execPlan.estimatedCodeSize +
            "\n");
    }
    // ── Stage 6: Codegen + Wrap ───────────────────────────────────────────────
    const rootName = resolvedGraph.metadata?.name ?? "Root";
    const rootWidth = resolvedGraph.metadata?.width ?? 1440;
    const rootHeight = resolvedGraph.metadata?.height ?? 900;
    const fontCode = (0, helpers_js_1.fontLoader)(resolvedGraph.fonts);
    const outputChunks = [];
    try {
        for (let i = 0; i < execPlan.chunks.length; i++) {
            const chunk = execPlan.chunks[i];
            const context = {
                transport,
                isMultiChunk,
                rootName,
                rootWidth,
                rootHeight,
                allImports: imports,
            };
            const code = (0, codegen_js_1.generateCode)(chunk, context);
            // For preload and single chunks, font loading is included in the wrap.
            // For build chunks in multi-chunk mode, fonts are already loaded in preload.
            const chunkFontCode = chunk.label === "preload" || !isMultiChunk ? fontCode : "";
            let wrappedCode;
            if (isMultiChunk && chunk.bridgeImports && chunk.bridgeImports.length > 0) {
                // Build chunk in multi-chunk mode: wrapChunk handles bridge imports
                wrappedCode = (0, wrap_js_1.wrapChunk)(code, chunk, transport, fileKey);
            }
            else if (transport === "official") {
                wrappedCode = (0, wrap_js_1.wrapOfficial)(code, chunkFontCode, fileKey, chunk.label);
            }
            else {
                wrappedCode = (0, wrap_js_1.wrapConsole)(code, chunkFontCode);
            }
            const description = chunk.label === "preload"
                ? "Preload: import " + execPlan.totalImports + " design tokens and create root frame"
                : isMultiChunk
                    ? "Build chunk " +
                        chunk.index +
                        ": create nodes " +
                        chunk.nodes.length +
                        " top-level elements"
                    : "Full build: " +
                        rootName +
                        " (" +
                        execPlan.totalImports +
                        " imports, " +
                        chunk.nodes.length +
                        " top-level nodes)";
            outputChunks.push({
                id: chunk.label,
                code: wrappedCode,
                description,
                timeoutMs: helpers_js_1.CHUNK_TIMEOUT_MS,
            });
        }
    }
    catch (err) {
        if (err instanceof errors_js_1.CompilerError) {
            return {
                success: false,
                errors: [err],
                warnings: allWarnings,
                chunks: [],
                plan: null,
            };
        }
        throw err;
    }
    return {
        success: true,
        errors: [],
        warnings: allWarnings,
        chunks: outputChunks,
        plan: {
            totalChunks: execPlan.chunks.length,
            totalImports: execPlan.totalImports,
            estimatedCodeSize: execPlan.estimatedCodeSize,
        },
    };
}
//# sourceMappingURL=compile.js.map