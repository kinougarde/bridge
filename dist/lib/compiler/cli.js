"use strict";
// lib/compiler/cli.ts
// CLI wrapper around the TypeScript compile pipeline.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCompileCli = runCompileCli;
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const compile_js_1 = require("./compile.js");
const errors_js_1 = require("./errors.js");
function parseArgs(argv) {
    const args = {
        input: null,
        kb: null,
        transport: "console",
        fileKey: null,
        out: null,
        chunkIndex: null,
        dryRun: false,
        verbose: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => {
            const v = argv[++i];
            if (v === undefined)
                throw new Error(`${arg} requires a value`);
            return v;
        };
        switch (arg) {
            case "--input":
                args.input = next();
                break;
            case "--kb":
                args.kb = next();
                break;
            case "--transport": {
                const v = next();
                if (v !== "console" && v !== "official") {
                    throw new Error(`--transport must be "console" or "official"`);
                }
                args.transport = v;
                break;
            }
            case "--file-key":
                args.fileKey = next();
                break;
            case "--out":
                args.out = next();
                break;
            case "--chunk-index":
                args.chunkIndex = Number.parseInt(next(), 10);
                break;
            case "--dry-run":
                args.dryRun = true;
                break;
            case "--verbose":
                args.verbose = true;
                break;
        }
    }
    return args;
}
async function runCompileCli(argv) {
    const args = parseArgs(argv);
    if (!args.input)
        throw new Error("--input <path> is required");
    if (!args.kb)
        throw new Error("--kb <path> is required");
    if (args.transport === "official" && !args.fileKey) {
        throw new Error("--file-key <key> is required for the official transport");
    }
    const inputPath = path.resolve(args.input);
    if (!(0, node_fs_1.existsSync)(inputPath))
        throw new Error(`input file not found: ${inputPath}`);
    const inputStr = await (0, promises_1.readFile)(inputPath, "utf8");
    const result = (0, compile_js_1.compile)({
        input: inputStr,
        kbPath: path.resolve(args.kb),
        transport: args.transport,
        fileKey: args.fileKey,
        verbose: args.verbose,
    });
    if (args.dryRun) {
        const output = {
            valid: result.success,
            errors: result.errors.map((e) => ({
                code: e.code,
                message: e.message,
                node: e.node,
                path: e.path,
            })),
            warnings: result.warnings.map((w) => ({
                code: w.code,
                message: w.message,
                node: w.node,
                path: w.path,
            })),
        };
        process.stdout.write(JSON.stringify(output, null, 2) + "\n");
        if (!result.success)
            process.exit(1);
        return;
    }
    if (!result.success) {
        process.stderr.write((0, errors_js_1.formatErrors)(result.errors) + "\n");
        process.exit(1);
    }
    if (result.warnings.length > 0) {
        process.stderr.write((0, errors_js_1.formatErrors)(result.warnings) + "\n");
    }
    const chunks = args.chunkIndex != null
        ? result.chunks.filter((_c, idx) => idx === args.chunkIndex)
        : result.chunks;
    if (args.out) {
        const outDir = path.resolve(args.out);
        await (0, promises_1.mkdir)(outDir, { recursive: true });
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const fileName = `chunk-${i}-${chunk.id}.js`;
            await (0, promises_1.writeFile)(path.join(outDir, fileName), chunk.code, "utf8");
        }
        const planMeta = {
            version: "3.0",
            chunks: result.chunks.map((c, idx) => ({
                index: idx,
                label: c.id,
                file: `chunk-${idx}-${c.id}.js`,
                description: c.description,
                timeoutMs: c.timeoutMs,
            })),
            transport: args.transport,
            totalChunks: result.plan?.totalChunks,
            totalImports: result.plan?.totalImports,
            estimatedCodeSize: result.plan?.estimatedCodeSize,
        };
        await (0, promises_1.writeFile)(path.join(outDir, "plan.json"), JSON.stringify(planMeta, null, 2) + "\n", "utf8");
        if (args.verbose) {
            process.stderr.write(`[output] wrote ${chunks.length} chunk(s) to ${outDir}\n`);
        }
    }
    else {
        process.stdout.write(JSON.stringify(chunks, null, 2) + "\n");
    }
}
//# sourceMappingURL=cli.js.map