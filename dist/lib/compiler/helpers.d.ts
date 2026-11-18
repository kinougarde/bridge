export declare const HELPER_BLOCK: string;
/**
 * How long one library import may stay unanswered before the chunk gives up on
 * it. Healthy preloads finish well inside figma-console's 5 s default, so this
 * only trips on an import Figma has stopped answering.
 */
export declare const IMPORT_TIMEOUT_MS = 30000;
/**
 * Execution timeout every compiled chunk declares, for the caller to pass to
 * `figma_execute`. It must exceed IMPORT_TIMEOUT_MS so the import error, which
 * names the stuck keys, comes back before the plugin's generic "Execution timed
 * out". Without it figma-console applies 5 s, after which the chunk keeps
 * running in Figma — and a retry stacks a second run on top of it.
 */
export declare const CHUNK_TIMEOUT_MS = 60000;
/**
 * Runtime helper for library imports, emitted only by chunks that import.
 *
 * `figma.import…ByKeyAsync` goes through Figma's servers and can stop
 * answering for the rest of the plugin session. Figma cannot cancel it: a
 * timeout only stops waiting, the import stays pending until the plugin is
 * closed. Two consequences shape this helper:
 *
 * - Imports are cached by key on `globalThis`, the pending promise included,
 *   so a retry waits on the import already in flight instead of stacking a new
 *   one behind it. A failed import is evicted so a retry starts afresh; a
 *   node removed since (undo) is re-imported.
 * - Every failure is collected and reported together with its method, key,
 *   name and how long it has been pending, instead of `Promise.all` keeping
 *   only the first one.
 *
 * `setTimeout` is guarded so a sandbox without it degrades to an unbounded
 * wait rather than a ReferenceError on every import.
 */
export declare const IMPORT_HELPER: string;
export interface FontRef {
    family: string;
    style: string;
}
/**
 * Returns a JavaScript code string that loads the given fonts via
 * figma.loadFontAsync.
 */
export declare function fontLoader(fonts: readonly FontRef[] | null | undefined): string;
//# sourceMappingURL=helpers.d.ts.map