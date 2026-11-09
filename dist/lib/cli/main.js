"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERSION = void 0;
exports.main = main;
// lib/cli/main.ts
const doctor_js_1 = require("./doctor.js");
const extract_js_1 = require("./extract.js");
const orchestrator_js_1 = require("../cron/orchestrator.js");
const migrate_js_1 = require("./migrate.js");
const lint_js_1 = require("./lint.js");
exports.VERSION = "7.7.0";
function printHelp() {
    console.log(`
bridge-ds v${exports.VERSION} — compiler-driven design system

Commands:
  setup                  Headless scaffold (typically invoked by 'setup bridge' in Claude Code)
  compile                Compile a scene graph JSON via the local compiler
  code                   Generate framework code from a scene graph
  import                 Turn an extracted Figma node tree into a scene graph
  drift                  Report knowledge-base drift against Figma (read-only)
  doctor                 Run diagnostics (config, connectivity, health)
  extract --headless     Extract DS via Figma REST (requires FIGMA_TOKEN)
  migrate                Migrate a legacy KB to the current schema
  cron                   Run the cron orchestrator (CI entry point)
  lint                   Lint *.cspec.yaml files against the lint config
  help | version

  code   --input <scene.json> --kb <path> [--out <dir>] [--name <n>]
         [--strategy tailwind-daisyui|css-vars] [--doc-language en|fr]
         [--base-class <Name>] [--base-class-import <path>] [--no-stories]
  import --tree <snapshot.json> --kb <path> [--out <scene.json>] [--name <n>]
  drift  --kb <path> [--config <docs.config.yaml>] [--update-baseline]
`);
}
async function main() {
    const [cmd, sub, ...rest] = process.argv.slice(2);
    try {
        switch (cmd) {
            case "setup": {
                const args = parseFlags(rest);
                const { scaffold } = await import("./setup-orchestrator.js");
                const created = await scaffold({
                    dsName: args.get("ds-name") ?? "DS",
                    figmaFileKey: args.get("figma-key") ?? "",
                    kbPath: args.get("kb-path"),
                });
                console.log(JSON.stringify({ scaffolded: created }, null, 2));
                return;
            }
            case "compile": {
                const { runCompileCli } = await import("../compiler/cli.js");
                await runCompileCli([sub, ...rest].filter((x) => typeof x === "string"));
                return;
            }
            case "code": {
                const args = parseFlags([sub, ...rest]);
                const input = args.get("input");
                if (!input)
                    throw new Error("`code` requires --input <scene.json>");
                const { codeCommand, formatCodeResult } = await import("./code.js");
                const outDir = args.get("out");
                const result = await codeCommand({
                    inputPath: input,
                    kbPath: args.get("kb") ?? "bridge-ds",
                    ...(outDir ? { outDir } : {}),
                    ...(args.has("name") ? { name: args.get("name") } : {}),
                    ...(args.has("strategy")
                        ? { strategy: args.get("strategy") }
                        : {}),
                    ...(args.has("doc-language")
                        ? { docLanguage: args.get("doc-language") }
                        : {}),
                    ...(args.has("base-class") ? { baseClass: args.get("base-class") } : {}),
                    ...(args.has("base-class-import")
                        ? { baseClassImport: args.get("base-class-import") }
                        : {}),
                    ...(process.argv.includes("--no-stories") ? { emitStories: false } : {}),
                });
                console.log(formatCodeResult(result, outDir));
                process.exit(result.exitCode);
                return;
            }
            case "import": {
                const args = parseFlags([sub, ...rest]);
                const tree = args.get("tree");
                if (!tree)
                    throw new Error("`import` requires --tree <snapshot.json>");
                const { importCommand } = await import("./import.js");
                const result = await importCommand({
                    treePath: tree,
                    kbPath: args.get("kb") ?? "bridge-ds",
                    ...(args.has("out") ? { outPath: args.get("out") } : {}),
                    ...(args.has("name") ? { name: args.get("name") } : {}),
                });
                process.exit(result.exitCode);
                return;
            }
            case "drift": {
                const args = parseFlags([sub, ...rest]);
                const { driftCommand, formatDriftReport } = await import("./drift.js");
                const report = await driftCommand({
                    kbPath: args.get("kb") ?? "bridge-ds",
                    ...(args.has("config") ? { configPath: args.get("config") } : {}),
                    ...(process.argv.includes("--update-baseline") ? { updateBaseline: true } : {}),
                });
                console.log(formatDriftReport(report));
                process.exit(report.exitCode);
                return;
            }
            case "doctor":
                await (0, doctor_js_1.doctor)(exports.VERSION);
                return;
            case "extract": {
                const headless = rest.includes("--headless") || sub === "--headless";
                if (!headless)
                    throw new Error("Only headless extraction is CLI-exposed. Use `extract --headless`.");
                console.log(await (0, extract_js_1.extractHeadless)({ configPath: "docs.config.yaml" }));
                return;
            }
            case "cron":
                console.log(await (0, orchestrator_js_1.runCron)({ configPath: "docs.config.yaml" }));
                return;
            case "lint": {
                const cfgIdx = process.argv.indexOf("--config");
                const sevIdx = process.argv.indexOf("--fail-severity");
                const coverage = process.argv.includes("--coverage");
                const exit = await (0, lint_js_1.lintCommand)({
                    configPath: cfgIdx >= 0 ? process.argv[cfgIdx + 1] : "bridge-ds/lint/config.yaml",
                    failSeverity: (sevIdx >= 0 ? process.argv[sevIdx + 1] : "warn"),
                    coverage,
                });
                process.exit(exit);
            }
            case "migrate": {
                const args = parseFlags([sub, ...rest]);
                const kbPath = args.get("kb-path") ?? ".";
                const result = await (0, migrate_js_1.migrate)({ kbPath });
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            case "version":
            case "--version":
            case "-v":
                console.log(`bridge-ds v${exports.VERSION}`);
                return;
            case "help":
            case "--help":
            case "-h":
            case undefined:
                printHelp();
                return;
            default:
                throw new Error(`Unknown command: ${cmd}`);
        }
    }
    catch (e) {
        const err = e;
        console.error(`Error: ${err.message}`);
        if (process.env.BRIDGE_DEBUG)
            console.error(err.stack);
        process.exit(1);
    }
}
/**
 * Parse `--key value` pairs, tolerating valueless boolean flags.
 *
 * A boolean flag is detected by its neighbour: if the next token is itself a
 * flag (or absent), the current one takes an empty value and only one position
 * is consumed. Advancing blindly by two would let a single boolean flag shift
 * every later pair by one, silently mis-assigning values.
 */
function parseFlags(rest) {
    const args = new Map();
    for (let i = 0; i < rest.length; i++) {
        const k = rest[i];
        if (!k?.startsWith("--"))
            continue;
        const next = rest[i + 1];
        if (next === undefined || next.startsWith("--")) {
            args.set(k.slice(2), "");
        }
        else {
            args.set(k.slice(2), next);
            i++;
        }
    }
    return args;
}
const invokedPath = process.argv[1] ?? "";
if (/[\\/]main\.(js|ts)$/.test(invokedPath)) {
    main();
}
//# sourceMappingURL=main.js.map