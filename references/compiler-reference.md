# Compiler Reference — Bridge DS v3

> **The only reference Claude reads at design-time.**
> The compiler enforces all 26 Figma API rules. Claude's job: produce a valid scene graph JSON.

---

## Compiler Iron Laws

<IRON-LAW>
Every `$token` reference resolves against the KB or compilation fails with `RESOLVE_TOKEN_NOT_FOUND` (Levenshtein-suggested alternatives included).
</IRON-LAW>

<IRON-LAW>
Every emitted Figma Plugin API call respects all 26 enforced rules. Rule violations are compile errors, never warnings.
</IRON-LAW>

<IRON-LAW>
Compiler output is deterministic for a given (input + KB) pair. No runtime randomness, no time-dependent codegen.
</IRON-LAW>

<IRON-LAW>
Multi-chunk plans preserve nodeId references across chunks via `globalThis` bridging — no chunk may rely on intra-chunk DOM state.
</IRON-LAW>

---

## 1. Scene Graph JSON Format

### Root Document

```json
{
  "version": "3.0",
  "metadata": {
    "name": "Screen Name",
    "width": 1440,
    "height": 900,
    "description": "Optional description",
    "transport": "console",
    "fileKey": "abc123"
  },
  "fonts": [
    { "family": "Inter", "style": "Regular" },
    { "family": "Inter", "style": "Semi Bold" }
  ],
  "nodes": [ ... ]
}
```

- `transport` and `fileKey` are optional (auto-detected; `fileKey` required for official transport).
- `fonts` must list every font family+style used by text styles in the design.
- `nodes` are the top-level children of the root frame.

### Token Reference Format

All spacing, color, radius, text style, and effect values MUST be `$token` references — never raw `px` or hex.

```
$spacing/md              → variable: spacing/medium
$color/bg/neutral/default → variable: color/background/neutral/default
$radius/lg               → variable: radius/large
$text/heading/xl         → text style: heading/xl
$effect/shadow/sm        → effect style: shadow/small
$comp/Button             → component: Button
$icon/ArrowRight         → icon component: ArrowRight
```

**Alias shortcuts** (expanded automatically by the compiler):

| Alias | Expands to |
|-------|-----------|
| `bg` | `background` |
| `fg` | `foreground` |
| `xs` | `xsmall` |
| `sm` | `small` |
| `md` | `medium` |
| `lg` | `large` |
| `xl` | `xlarge` |
| `xxl` | `xxlarge` |

---

## 2. Node Type Quick Reference

All nodes share these base properties: `type`, `name`, `id?`, `children?`, `fillH?`, `fillV?`, `absolute?`, `visible?`, `opacity?`.

| Type | Required | Key Properties | Maps To |
|------|----------|---------------|---------|
| **FRAME** | `name` | `layout`, `gap`, `padding`, `fill`, `stroke`, `radius`, `clip`, `width`, `height`, `primaryAxisSizing`, `counterAxisSizing`, `primaryAxisAlign`, `counterAxisAlign`, `effectStyle`, `children` | `figma.createFrame()` |
| **TEXT** | `name`, `characters`, `textStyle` | `fill`, `autoResize`, `maxLines` | `figma.createText()` |
| **INSTANCE** | `name`, `component` | `variant`, `properties`, `swaps`, `overrides[]` | `importComponentByKeyAsync` / `importComponentSetByKeyAsync` + `createInstance()` |
| **CLONE** | `name`, one of `sourceNodeId` / `sourceRef` | `overrides[]` (each: `find.name`, `set.*`) | `node.clone()` |
| **RECTANGLE** | `name`, `width`, `height` | `fill`, `stroke`, `strokeWeight`, `strokeAlign`, `radius` | `figma.createRectangle()` |
| **ELLIPSE** | `name`, `width`, `height` | `fill`, `stroke`, `strokeWeight` | `figma.createEllipse()` |
| **REPEAT** | `name`, `count`, `template[]` | `data[]` (per-iteration bindings, `{{key}}` in characters) | Expands to N copies (not a Figma node) |
| **CONDITIONAL** | `name`, `when` | `children`, `else?` | Include/exclude (not a Figma node) |

---

## 3. FRAME Properties Detail

```json
{
  "type": "FRAME",
  "name": "Sidebar",
  "layout": "VERTICAL",
  "gap": "$spacing/md",
  "padding": "$spacing/lg",
  "fill": "$color/bg/neutral/default",
  "radius": "$radius/md",
  "clip": true,
  "fillH": true,
  "fillV": true,
  "width": 300,
  "height": 600,
  "primaryAxisSizing": "AUTO",
  "counterAxisSizing": "FIXED",
  "primaryAxisAlign": "MIN",
  "counterAxisAlign": "CENTER",
  "stroke": "$color/border/neutral/default",
  "strokeWeight": 1,
  "strokeAlign": "INSIDE",
  "children": [ ... ]
}
```

- `padding` is shorthand for all four sides. Use `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft` for asymmetric padding.
- `radius` is shorthand for all corners. Use `radiusTopLeft`, etc. for individual corners.
- `width`/`height` set initial `resize()` dimensions. Sizing modes (`primaryAxisSizing`, `counterAxisSizing`) control whether the frame grows.

---

## 4. Component Usage

### INSTANCE Node

```json
{
  "type": "INSTANCE",
  "name": "Primary Button",
  "component": "Button",
  "variant": { "size": "large", "variant": "primary" },
  "properties": { "label": "Submit", "hasTrailingIcon": true },
  "swaps": { "leadingIcon": "IconArrowRight" },
  "fillH": true
}
```

- `component`: name from the DS registry (case-insensitive).
- `variant`: object of variant property keys to values. The compiler validates against known variant options.
- `properties`: text and boolean overrides. The compiler handles hash-suffix property key resolution.
- `swaps`: instance swap overrides. Values are component names resolved to keys.
- `overrides`: deep overrides on descendants the component does not expose as
  properties — same shape as on CLONE (see below). This is the escape hatch for
  a DS component whose content lives in nested layers (a table's cells, a rail's
  items). It writes ordinary Figma overrides, so the instance KEEPS its link to
  the master. It is not a licence to rebuild a component out of atoms, and it is
  never a reason to detach.
- INSTANCE nodes CANNOT have `children` (compiler error).

```json
{
  "type": "INSTANCE",
  "name": "Table",
  "component": "am-table",
  "variant": { "pagination": "Oui", "état": "Rempli", "colonnes": "4" },
  "overrides": [
    { "find": { "name": "am-table-header-cell", "nth": 0 },
      "set": { "properties": { "Libellé#11402:5": "Intervenant" } } },
    { "find": { "name": "am-table-cell-value", "nth": 1 },
      "set": { "properties": { "Valeur#11402:7": "Cambrai" } } },
    { "find": { "name": "badge-fg", "type": "TEXT", "nth": 0 },
      "set": { "characters": "Planifié" } }
  ]
}
```

`variant` keys must be listed in the SAME ORDER as the variant's name in Figma:
the compiler joins them into `"k=v, k=v"` and matches that string. A mismatch
falls back to `defaultVariant` instead of failing — check the render.

### CLONE Node

```json
{
  "type": "CLONE",
  "name": "Sidebar Copy",
  "sourceRef": "sidebar",
  "overrides": [
    {
      "find": { "name": "Title", "type": "TEXT" },
      "set": { "characters": "New Title", "fill": "$color/text/accent/default" }
    }
  ]
}
```

- Use `sourceRef` to reference another node's `id` field (local clone).
- Use `sourceNodeId` for Figma node IDs (reference-based or unpublished components).

### Override selectors (CLONE and INSTANCE)

- `find.name` is required; `find.type` narrows by node type.
- `find.nth` (0-based, document order) picks among several matches. Repeated
  layer names are the NORM inside a DS component — five cells all named
  `am-table-cell-value`, six items all named `am-rail-item` — and WITHOUT `nth`
  the first match wins every time, silently.
- `set` accepts `characters` (TEXT node — its own font is loaded first),
  `fill` (a `$token`, resolved and imported like any other), `visible`, and
  `properties` (forwarded to `setProperties` — the right tool for a nested
  INSTANCE that does expose component properties).
- Indices are per layer name, and different layer names do not line up: a
  4-column `am-table` has 4 `am-table-header-cell` but only 3
  `am-table-cell-value` per row, because the badge column uses a different
  cell component. Read the anatomy before counting.

---

## 5. Compiler Invocation

```bash
bridge-ds compile --input <json-file> --kb <kb-path> --transport <console|official> [--dry-run]
```

*(Equivalent: `node dist/lib/compiler/cli.js ...` after `npm run build`.)*

**Output:** JSON array of `{ id, code, description, timeoutMs }` chunks to stdout. Pass
`timeoutMs` as the `timeout` of `figma_execute`: it outlasts the per-import timeout (30 s), so a
library import Figma stopped answering is reported by key and name instead of as a generic
execution timeout.
**Errors:** Structured errors to stderr with fuzzy suggestions for unresolved tokens/components.

### Pipeline

```
Input JSON → PARSE → RESOLVE → VALIDATE → PLAN → CODEGEN → WRAP → Output chunks
```

The compiler handles: JSON validation, token resolution, structural validation (FILL in AUTO parent, raw shapes matching DS components, orphan clones), chunking for large designs, code generation with all 26 Figma API rules enforced, and transport-specific wrapping.

---

## 6. Claude's Workflow

1. **Read** CSpec YAML (from spec phase) or generate from user description.
2. **Convert** to scene graph JSON (`nodes` array with `$token` references).
3. **Write** JSON to a temp file.
4. **Run** the compiler: `bridge-ds compile --input /tmp/scene.json --kb <kb-path> --transport console`.
5. **Execute** each output chunk via `figma_execute` (console) or `use_figma` (official).
6. **Screenshot** after the final chunk to verify the result.

---

## 7. Key Rules

These are the rules Claude must follow when producing scene graph JSON. The compiler enforces them — but producing correct input avoids round-trips.

1. **Every spacing/padding/radius** MUST be a `$token` ref (never raw px values).
2. **Every color** (fill, stroke) MUST be a `$token` ref (never hex values).
3. **Every TEXT node** MUST have a `textStyle` ref (never hardcode font properties).
4. **DS components** MUST be INSTANCE nodes (never recreate as FRAME/RECTANGLE).
5. **INSTANCE nodes** CANNOT have children — use `properties`, `swaps`, and
   `overrides[]` (deep, keeps the master link) instead.
6. **Node names** become Figma layer names — make them descriptive and unique within their parent.
7. **Use REPEAT** for lists and grids with repeated structure.
8. **Use CONDITIONAL** sparingly — prefer resolving conditions before producing the scene graph.
9. **RECTANGLE/ELLIPSE** are only for raw decorative elements with no DS component equivalent.
10. **`fillH`/`fillV`** should not be used on children of frames with `primaryAxisSizing: "AUTO"` (causes collapsed layout).

---

## 8. Error Handling

If the compiler returns errors:

1. **Read** the error messages and suggestions from stderr.
2. **Fix** the scene graph JSON based on the suggestions.
3. **Re-run** the compiler.

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `RESOLVE_TOKEN_NOT_FOUND` | Token path doesn't match any registry entry | Check spelling, use aliases (`md` not `medium`), verify token exists in KB |
| `RESOLVE_COMPONENT_NOT_FOUND` | Component name not in registry | Check registry for exact name (case-insensitive) |
| `RESOLVE_VARIANT_INVALID` | Variant key or value not recognized | Check component's known variant properties |
| `VALIDATE_FILL_IN_AUTO_PARENT` | `fillH`/`fillV` on child of AUTO-sized parent | Change parent to `FIXED` sizing or remove fill on child |
| `VALIDATE_RAW_SHAPE_HAS_DS_MATCH` | RECTANGLE/ELLIPSE name matches a DS component | Use INSTANCE node instead |
| `VALIDATE_TEXT_NO_STYLE` | TEXT node missing `textStyle` | Add a `$text/...` reference |
| `VALIDATE_INSTANCE_HAS_CHILDREN` | INSTANCE node has `children` array | Remove children, use `properties`/`swaps` instead |
| `PARSE_RAW_VALUE_NOT_ALLOWED` | Raw number in spacing/radius/color field | Replace with `$token` reference |
