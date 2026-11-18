// ---------------------------------------------------------------------------
// helpers.ts — runtime helper block + font loader code generation
// ---------------------------------------------------------------------------

export const HELPER_BLOCK: string = [
  "// ─── HELPERS ───",
  "function mf(colorVar) {",
  '  var p = figma.util.solidPaint("#000000");',
  '  p = figma.variables.setBoundVariableForPaint(p, "color", colorVar);',
  "  return [p];",
  "}",
  "",
  "function appendFill(parent, child, fillH, fillV) {",
  "  parent.appendChild(child);",
  '  if (fillH) child.layoutSizingHorizontal = "FILL";',
  '  if (fillV) child.layoutSizingVertical = "FILL";',
  "}",
  "",
  "function bindPadding(frame, top, right, bottom, left) {",
  '  if (top) frame.setBoundVariable("paddingTop", top);',
  '  if (right) frame.setBoundVariable("paddingRight", right);',
  '  if (bottom) frame.setBoundVariable("paddingBottom", bottom);',
  '  if (left) frame.setBoundVariable("paddingLeft", left);',
  "}",
  "",
  "function bindRadius(frame, radiusVar) {",
  '  frame.setBoundVariable("topLeftRadius", radiusVar);',
  '  frame.setBoundVariable("topRightRadius", radiusVar);',
  '  frame.setBoundVariable("bottomLeftRadius", radiusVar);',
  '  frame.setBoundVariable("bottomRightRadius", radiusVar);',
  "}",
  "",
  "function findPropKey(compSet, prefix, type) {",
  "  var defs = compSet.componentPropertyDefinitions;",
  "  return Object.keys(defs).find(function(k) {",
  "    return k.split('#')[0] === prefix && defs[k].type === type;",
  "  });",
  "}",
  "",
  "// Writing to a TEXT node throws unless ITS OWN font is loaded, and a node",
  "// reached by a deep override is not necessarily built from a font the scene",
  "// graph declares — so the chunk-level font loader does not cover it.",
  "async function setChars(n, v) {",
  '  if (!n || n.type !== "TEXT") return false;',
  "  var len = n.characters.length;",
  "  var fonts = len > 0 ? n.getRangeAllFontNames(0, len) : [n.fontName];",
  "  for (var i = 0; i < fonts.length; i++) {",
  "    if (fonts[i] && fonts[i] !== figma.mixed) await figma.loadFontAsync(fonts[i]);",
  "  }",
  "  n.characters = v;",
  "  return true;",
  "}",
].join("\n");

/**
 * How long one library import may stay unanswered before the chunk gives up on
 * it. Healthy preloads finish well inside figma-console's 5 s default, so this
 * only trips on an import Figma has stopped answering.
 */
export const IMPORT_TIMEOUT_MS = 30_000;

/**
 * Execution timeout every compiled chunk declares, for the caller to pass to
 * `figma_execute`. It must exceed IMPORT_TIMEOUT_MS so the import error, which
 * names the stuck keys, comes back before the plugin's generic "Execution timed
 * out". Without it figma-console applies 5 s, after which the chunk keeps
 * running in Figma — and a retry stacks a second run on top of it.
 */
export const CHUNK_TIMEOUT_MS = 60_000;

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
export const IMPORT_HELPER: string = [
  "// ─── LIBRARY IMPORTS ───",
  "function importOne(method, key, timeoutMs) {",
  "  var cache = globalThis.__bridgeImports || (globalThis.__bridgeImports = {});",
  "  var entry = cache[key];",
  "  if (entry && entry.value && entry.value.removed) entry = null;",
  "  if (!entry) {",
  "    entry = { since: Date.now(), value: null };",
  '    entry.p = method === "importVariableByKeyAsync"',
  "      ? figma.variables.importVariableByKeyAsync(key)",
  "      : figma[method](key);",
  "    entry.p.then(",
  "      function(v) { entry.value = v; },",
  "      function() { if (cache[key] === entry) delete cache[key]; }",
  "    );",
  "    cache[key] = entry;",
  "  }",
  '  if (typeof setTimeout !== "function") return entry.p;',
  "  return new Promise(function(resolve, reject) {",
  "    var timer = setTimeout(function() {",
  '      var e = new Error("no answer, pending for " + Math.round((Date.now() - entry.since) / 1000) + "s");',
  "      e.bridgeTimeout = true;",
  "      reject(e);",
  "    }, timeoutMs);",
  "    entry.p.then(",
  "      function(v) { clearTimeout(timer); resolve(v); },",
  "      function(e) { clearTimeout(timer); reject(e); }",
  "    );",
  "  });",
  "}",
  "",
  "async function importAll(list, timeoutMs) {",
  "  var settled = await Promise.all(list.map(function(item) {",
  "    return importOne(item[0], item[1], timeoutMs).then(",
  "      function(v) { return { ok: true, value: v }; },",
  "      function(e) { return { ok: false, item: item, error: e }; }",
  "    );",
  "  }));",
  "  var failed = settled.filter(function(r) { return !r.ok; });",
  "  if (failed.length === 0) return settled.map(function(r) { return r.value; });",
  "  var stuck = false;",
  "  var lines = failed.map(function(r) {",
  "    if (r.error && r.error.bridgeTimeout) stuck = true;",
  "    var msg = r.error && r.error.message ? r.error.message : String(r.error);",
  '    return "  " + r.item[0] + " " + r.item[1] + " (" + r.item[2] + "): " + msg;',
  "  });",
  '  var text = "bridge: " + failed.length + " of " + list.length + " library imports failed\\n" + lines.join("\\n");',
  "  if (stuck) {",
  '    text += "\\nFigma cannot cancel a pending library import, and a retry in this plugin session " +',
  '      "waits on the same one. Close and reopen the Desktop Bridge plugin in Figma, then run this chunk again.";',
  "  }",
  "  throw new Error(text);",
  "}",
].join("\n");

export interface FontRef {
  family: string;
  style: string;
}

/**
 * Returns a JavaScript code string that loads the given fonts via
 * figma.loadFontAsync.
 */
export function fontLoader(fonts: readonly FontRef[] | null | undefined): string {
  if (!fonts || !fonts.length) return "";
  const lines = fonts.map(
    (f) =>
      "await figma.loadFontAsync({ family: " +
      JSON.stringify(f.family) +
      ", style: " +
      JSON.stringify(f.style) +
      " });"
  );
  return lines.join("\n");
}
