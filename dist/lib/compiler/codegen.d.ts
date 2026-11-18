import type { Chunk } from "./plan.js";
import type { ImportBundle, ImportEntry, ResolvedToken } from "./types.js";
/**
 * Convert a token ref like "$spacing/md" to a safe JS variable name.
 */
export declare function refToVarName(ref: string): string;
/**
 * Build a safe variable name from a node name, with a counter for uniqueness.
 */
export declare function safeNodeVar(type: string, name: string | undefined, counters: Map<string, number>): string;
/**
 * Build a safe variable name for an import (variable, component, style).
 */
export declare function importVarName(entry: ImportEntry | ResolvedToken, seen: Map<string, string>): string;
/**
 * Generate import statements for variables, components, and styles.
 * `importNames` is mutated to accumulate `key → varName` mappings.
 *
 * Every import goes through the `importAll` runtime helper (IMPORT_HELPER),
 * emitted alongside: imports still run in parallel, but each one is bounded by
 * IMPORT_TIMEOUT_MS, cached by key across retries, and reported by key and
 * name when it fails.
 */
export declare function emitImports(imports: ImportBundle, importNames: Map<string, string>, bridgePrefix: string | null): string;
/**
 * Get the import variable name for a resolved token object.
 */
export declare function tokenVar(token: unknown, importNames: Map<string, string>): string | null;
export interface CodegenContext {
    transport?: string;
    isMultiChunk?: boolean;
    rootName?: string;
    rootWidth?: number;
    rootHeight?: number;
    allImports?: ImportBundle;
}
/**
 * Generate Figma Plugin API JavaScript code from a resolved chunk.
 */
export declare function generateCode(chunk: Chunk, context?: CodegenContext): string;
//# sourceMappingURL=codegen.d.ts.map