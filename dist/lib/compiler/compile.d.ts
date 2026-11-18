import { CompilerError } from "./errors.js";
import type { Transport } from "./wrap.js";
import type { LintDiagnostic } from "../lint/types.js";
export interface CompileOptions {
    /** JSON string or parsed scene graph. */
    input: string | object;
    /** Path to the knowledge-base directory. */
    kbPath: string;
    /** Transport. Defaults to `"console"`. */
    transport?: Transport;
    /** Figma file key (required for the `official` transport). */
    fileKey?: string | null;
    /** Print resolution details to stderr. */
    verbose?: boolean;
}
export interface CompiledChunk {
    id: string;
    code: string;
    description: string;
    /** Execution timeout to pass to `figma_execute` (its `timeout` argument). */
    timeoutMs: number;
}
export interface CompilePlanSummary {
    totalChunks: number;
    totalImports: number;
    estimatedCodeSize: number;
}
export interface CompileResult {
    success: boolean;
    errors: CompilerError[];
    warnings: CompilerError[];
    chunks: CompiledChunk[];
    plan: CompilePlanSummary | null;
}
/**
 * Options accepted by the spec-first `compile(spec, opts)` overload
 * introduced in v7. Used to gate compilation on `surface: compile-time`
 * lint rules before the scene graph is emitted.
 */
export interface CompileLintOptions {
    /** Path to a `bridge-lint.config.yaml` file. */
    lintConfigPath?: string;
}
/**
 * Result returned by the spec-first `compile(spec, opts)` overload.
 *
 * Mirrors {@link CompileResult} in spirit but uses `ok` (truthy on success)
 * and exposes blocking lint diagnostics directly instead of wrapping them
 * in {@link CompilerError}. `sceneGraph` is `null` whenever lint blocks
 * before scene-graph emission.
 */
export interface CompileLintResult {
    ok: boolean;
    errors: LintDiagnostic[];
    sceneGraph: null;
}
/**
 * Compile a scene graph JSON into executable Figma Plugin API chunks.
 *
 * Two calling conventions are supported:
 *
 * 1. **Legacy (sync)** — `compile(options)` where `options` is a
 *    {@link CompileOptions} object containing `input` + `kbPath`. Returns a
 *    {@link CompileResult} synchronously. This is the path used by the
 *    `bridge-ds compile` CLI and by all v6 callers.
 *
 * 2. **Spec-first (async)** — `compile(spec, opts)` where `spec` is a raw
 *    CSpec document and `opts` is a {@link CompileLintOptions} carrying a
 *    `lintConfigPath`. Returns a {@link CompileLintResult} that surfaces
 *    blocking lint diagnostics without touching the scene-graph pipeline.
 */
export declare function compile(options: CompileOptions): CompileResult;
export declare function compile(spec: unknown, opts: CompileLintOptions): Promise<CompileLintResult>;
//# sourceMappingURL=compile.d.ts.map