# Transport Adapter — Dual MCP Transport Support

> **Single source of truth for transport detection, tool mapping, and script adaptation.**
> All other reference files point here instead of duplicating transport logic.

---

## A. Transport Detection

Before any Figma operation, determine which transport is active:

1. **Check for console transport:** Is `figma_execute` available?
2. **Check for official transport:** Is `use_figma` available?

| Result | Transport | Action |
|--------|-----------|--------|
| `figma_execute` available | **Console** (preferred) | Use console tool names throughout |
| `use_figma` available (no console) | **Official** | Use official tool names, apply adaptation rules below |
| Both available | **Console** (preferred) | Console is more capable, no response limits |
| Neither available | **Blocked** | Show setup instructions for both options (see below) |

**Block message when neither is available:**
```
No Figma MCP transport detected. Configure one of these:

Option A — figma-console-mcp (recommended, full Plugin API access):
  claude mcp add figma-console -s user -e FIGMA_ACCESS_TOKEN=figd_YOUR_TOKEN -- npx -y figma-console-mcp@latest

Option B — Official Figma MCP (cloud-based, cross-library search):
  Configure via Claude settings or Figma's MCP integration.
```

In Claude Code the Bridge plugin already provides the console transport, shared
by every conversation (Section H); Option A is for clients without the plugin.

---

## B. Tool Mapping Table

| Bridge Operation | Console (preferred) | Official Figma MCP | Notes |
|---|---|---|---|
| Execute Plugin API code | `figma_execute` | `use_figma` | Different wrapper format (see Section C) |
| Take screenshot | `figma_take_screenshot` | `get_screenshot` | Official requires `nodeId` + `fileKey` |
| Full DS extraction | `figma_get_design_system_kit` | Composite strategy (see Section D) | |
| Get variables | `figma_get_variables` | `get_variable_defs` | |
| Get styles | `figma_get_styles` | `search_design_system` (includeStyles) | |
| Connection check | `figma_get_status` | `whoami` + test `use_figma` call | See Section F |
| Search components | `figma_search_components` | `search_design_system` (includeComponents) | Official searches cross-library |
| Get component | `figma_get_component` | `get_design_context` or `get_metadata` | |

---

## C. Script Adaptation Rules

### Console transport (figma_execute)

IIFE wrapper is **mandatory**. The `return` before the IIFE is required.

```javascript
// Console: figma_execute({ code: "..." })
return (async function() {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  // ... Plugin API code ...
  return { success: true };
})();
```

### Official transport (use_figma)

Top-level `await` — **no IIFE wrapper**. Requires `fileKey` and `description` parameters.

```javascript
// Official: use_figma({ fileKey: "...", description: "...", code: "..." })
await figma.loadFontAsync({ family: "Inter", style: "Regular" });
// ... Plugin API code ...
return { success: true };
```

### Compiler transport flag

The Bridge DS compiler (`bridge-ds compile`, sources under `lib/compiler/`) accepts `--transport console|official` and generates the correct script format automatically (IIFE wrapper for console, top-level await for official). Claude still needs this document for MCP tool selection (`figma_execute` vs `use_figma`, `figma_take_screenshot` vs `get_screenshot`, etc.) — the compiler only handles code wrapping, not tool invocation.

### Key differences

| Aspect | Console | Official |
|--------|---------|----------|
| Wrapper | `return (async function() { ... })();` | Top-level `await`, no IIFE |
| Parameters | `{ code }` | `{ fileKey, description, code }` |
| `figma.notify()` | Allowed | **Forbidden** (no UI access) |
| `getPluginData()` | Allowed | **Forbidden** (use `getSharedPluginData()`) |
| Response size | Unlimited | **20KB limit** — chunk large extractions |
| Document access | Current file via plugin | Specified file via `fileKey` |

### Transformation example

**Same script in both formats:**

Console:
```javascript
return (async function() {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  var frame = figma.createFrame();
  frame.name = "Test";
  frame.resize(400, 300);
  figma.currentPage.appendChild(frame);
  return { id: frame.id, name: frame.name };
})();
```

Official:
```javascript
await figma.loadFontAsync({ family: "Inter", style: "Regular" });
var frame = figma.createFrame();
frame.name = "Test";
frame.resize(400, 300);
figma.currentPage.appendChild(frame);
return { id: frame.id, name: frame.name };
```

Called as: `use_figma({ fileKey: "YOUR_FILE_KEY", description: "Create a test frame", code: "..." })`

---

## D. DS Extraction Composite Strategy

When `figma_get_design_system_kit` is unavailable (official transport), extract DS data using multiple tools:

### 1. Variables

```
get_variable_defs({ fileKey }) → collection/variable structure
```

If `get_variable_defs` does not return keys suitable for `importVariableByKeyAsync`, supplement with a `use_figma` extraction script (same script as in `schemas/variables.md`, without the IIFE wrapper).

### 2. Components

```
search_design_system({ query: "*", includeComponents: true }) → component list
```

Run broad queries per category (e.g., "Button", "Input", "Card") to cover the DS. For detailed component properties, use `use_figma` with the extraction script from `schemas/components.md` (without IIFE wrapper).

### 3. Styles

```
search_design_system({ query: "*", includeStyles: true }) → text/color/effect styles
```

If keys are not returned, supplement with a `use_figma` extraction script (from `schemas/text-styles.md`, without IIFE wrapper).

### 4. Assembly

Assemble extracted data into the same registry JSON format defined in the schemas. The output registries must be identical regardless of which transport was used for extraction.

---

## E. Screenshot Adaptation

### Console

```
figma_take_screenshot({ node_id: "123:456" })
```

`node_id` is optional — omitting it captures the current viewport.

### Official

```
get_screenshot({ nodeId: "123:456", fileKey: "abc123" })
```

Both `nodeId` and `fileKey` are **required**. Track these values throughout the workflow:
- `fileKey`: obtained when the user provides the Figma file URL
- `nodeId`: returned by script execution (root frame ID from generation steps)

---

## F. Connection Check Adaptation

### Console

```
figma_get_status() → { setup: { valid: true }, ... }
```

Success: `setup.valid === true` means Figma Desktop is connected.

### Official

```
whoami() → { name: "...", email: "..." }
```

Success means the user is authenticated. Then test actual file access:
```
use_figma({ fileKey: "...", description: "Connection test", code: "return { page: figma.currentPage.name };" })
```

If both succeed, the official transport is operational.

---

## G. Official Transport Bonus Capabilities

These tools are only available on the official transport and provide additional functionality:

| Tool | Capability |
|------|------------|
| `search_design_system` | **Cross-library search** — finds components/styles across all team libraries, not just the current file |
| `get_code_connect_map` | Retrieve Code Connect mappings between Figma components and code |
| `add_code_connect_map` | Create Code Connect mappings |
| `create_design_system_rules` | Export design system rules |
| `generate_figma_design` | Capture a web page into Figma (web-to-Figma) |
| `get_design_context` | Rich component context with code hints |
| `get_metadata` | File-level metadata and structure |

---

## H. How the Plugin Runs figma-console

Every figma-console process binds one port of 9223–9232 when it starts, whether
or not the conversation ever touches Figma, and keeps it until it exits. The
Desktop Bridge plugin's manifest only reaches that range. Started once per
conversation, ten open conversations fill it, and any other local tool that
serves the plugin finds no port.

So the plugin does not start figma-console per conversation. It starts
`bin/figma-console-relay.js`, which binds no port and forwards the conversation
to **one figma-console shared by every conversation**:

- The first conversation that needs it starts it — detached, so it outlives
  that conversation — with MCP over HTTP on `127.0.0.1:9300`
  (figma-console-mcp ≥ 1.44, `FIGMA_MCP_HTTP_PORT`). The others reuse it. A
  lock in the temp directory makes conversations opened at the same moment
  start it once.
- However many conversations are open, it takes one port of the range.
- figma-console closes sessions idle for 30 minutes, and the server can be
  restarted; the relay then replays the conversation's `initialize` and resends
  the message, so the conversation does not notice.
- Its log is `bridge-figma-console.log` in the temp directory, rewritten at
  each start. To stop it, end the `node` process whose command line ends in
  `figma-console-relay.js --serve`; the next conversation starts a new one.
- `BRIDGE_FIGMA_HTTP_PORT` moves the HTTP port. It must sit outside 9223–9232
  and must not be 3845 (Figma's Dev Mode MCP server).

Nothing to configure. One thing to undo: a figma-console you added yourself
(`claude mcp add figma-console …`) still starts its own server in every
conversation and takes a port in each. Remove it with
`claude mcp remove figma-console -s user`; the plugin's provides the same tools.
