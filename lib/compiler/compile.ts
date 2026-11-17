// ---------------------------------------------------------------------------
// compile.ts — pipeline orchestrator (programmatic entry point)
// ---------------------------------------------------------------------------

import { validateSceneGraph } from "./schema.js";
import { loadRegistry } from "./registry.js";
import { resolve } from "./resolve.js";
import { validate } from "./validate.js";
import { plan } from "./plan.js";
import { generateCode } from "./codegen.js";
import { CHUNK_TIMEOUT_MS, fontLoader } from "./helpers.js";
import { wrapChunk, wrapConsole, wrapOfficial } from "./wrap.js";
import { CompilerError } from "./errors.js";
import { runLintAtCompileTime } from "../lint/compile-bridge.js";
import type { Transport } from "./wrap.js";
import type { CodegenContext } from "./codegen.js";
import type { LintDiagnostic } from "../lint/types.js";

// ---------------------------------------------------------------------------
// PUBLIC TYPES
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// compile()
// ---------------------------------------------------------------------------

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
export function compile(options: CompileOptions): CompileResult;
export function compile(spec: unknown, opts: CompileLintOptions): Promise<CompileLintResult>;
export function compile(
  optionsOrSpec: CompileOptions | unknown,
  maybeOpts?: CompileLintOptions
): CompileResult | Promise<CompileLintResult> {
  // Spec-first overload: second positional argument is present.
  if (maybeOpts !== undefined) {
    return compileWithLint(optionsOrSpec, maybeOpts);
  }
  return compileLegacy(optionsOrSpec as CompileOptions);
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
async function compileWithLint(
  spec: unknown,
  opts: CompileLintOptions
): Promise<CompileLintResult> {
  if (opts.lintConfigPath) {
    const lintResult = await runLintAtCompileTime(spec, opts.lintConfigPath);
    const blocking = lintResult.diagnostics.filter((d) => d.severity === "error");
    if (blocking.length > 0) {
      return { ok: false, errors: blocking.slice(), sceneGraph: null };
    }
  }
  return { ok: true, errors: [], sceneGraph: null };
}

function compileLegacy(options: CompileOptions): CompileResult {
  const opts = options ?? ({} as CompileOptions);
  const transport: Transport = opts.transport ?? "console";
  const fileKey: string | null = opts.fileKey ?? null;
  const verbose = opts.verbose ?? false;

  // ── Stage 1: Parse + schema validation ────────────────────────────────────

  let json: unknown;
  if (typeof opts.input === "string") {
    try {
      json = JSON.parse(opts.input);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        errors: [
          new CompilerError("PARSE_INVALID_JSON", {
            message: "Failed to parse input JSON: " + msg,
          }),
        ],
        warnings: [],
        chunks: [],
        plan: null,
      };
    }
  } else if (opts.input && typeof opts.input === "object") {
    json = opts.input;
  } else {
    return {
      success: false,
      errors: [
        new CompilerError("PARSE_INVALID_JSON", {
          message: "Input must be a JSON string or object",
        }),
      ],
      warnings: [],
      chunks: [],
      plan: null,
    };
  }

  const schemaResult = validateSceneGraph(json);
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

  const registry = loadRegistry(opts.kbPath);

  // ── Stage 3: Resolve ──────────────────────────────────────────────────────

  const resolveResult = resolve(graph, registry);

  if (verbose) {
    const imp = resolveResult.imports;
    const vCount = imp.variables?.length ?? 0;
    const cCount = imp.components?.length ?? 0;
    const sCount = imp.textStyles?.length ?? 0;
    const fCount = imp.fonts?.length ?? 0;
    process.stderr.write(
      "[resolve] variables=" +
        vCount +
        " components=" +
        cCount +
        " styles=" +
        sCount +
        " fonts=" +
        fCount +
        "\n"
    );
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
  const allWarnings: CompilerError[] = resolveResult.warnings.slice();

  // ── Stage 4: Validate ─────────────────────────────────────────────────────

  const validateResult = validate(resolvedGraph, registry);

  if (validateResult.warnings.length > 0) {
    for (const w of validateResult.warnings) allWarnings.push(w);
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

  const execPlan = plan(resolvedGraph, imports, { transport });
  const isMultiChunk = execPlan.chunks.length > 1;

  if (verbose) {
    process.stderr.write(
      "[plan] chunks=" +
        execPlan.chunks.length +
        " totalImports=" +
        execPlan.totalImports +
        " estimatedSize=" +
        execPlan.estimatedCodeSize +
        "\n"
    );
  }

  // ── Stage 6: Codegen + Wrap ───────────────────────────────────────────────

  const rootName = resolvedGraph.metadata?.name ?? "Root";
  const rootWidth = resolvedGraph.metadata?.width ?? 1440;
  const rootHeight = resolvedGraph.metadata?.height ?? 900;
  const fontCode = fontLoader(resolvedGraph.fonts);

  const outputChunks: CompiledChunk[] = [];

  try {
    for (let i = 0; i < execPlan.chunks.length; i++) {
      const chunk = execPlan.chunks[i]!;

      const context: CodegenContext = {
        transport,
        isMultiChunk,
        rootName,
        rootWidth,
        rootHeight,
        allImports: imports,
      };

      const code = generateCode(chunk, context);

      // For preload and single chunks, font loading is included in the wrap.
      // For build chunks in multi-chunk mode, fonts are already loaded in preload.
      const chunkFontCode = chunk.label === "preload" || !isMultiChunk ? fontCode : "";

      let wrappedCode: string;
      if (isMultiChunk && chunk.bridgeImports && chunk.bridgeImports.length > 0) {
        // Build chunk in multi-chunk mode: wrapChunk handles bridge imports
        wrappedCode = wrapChunk(code, chunk, transport, fileKey);
      } else if (transport === "official") {
        wrappedCode = wrapOfficial(code, chunkFontCode, fileKey, chunk.label);
      } else {
        wrappedCode = wrapConsole(code, chunkFontCode);
      }

      const description =
        chunk.label === "preload"
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
        timeoutMs: CHUNK_TIMEOUT_MS,
      });
    }
  } catch (err) {
    if (err instanceof CompilerError) {
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
