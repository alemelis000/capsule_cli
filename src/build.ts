import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { CapsuleConfig, deriveManifest } from "./config.js";

export interface BuildResult {
  outDir: string;
  wasmPath: string;
  manifestPath: string;
  migrationsPath?: string;
}

const DIST_DIR = path.dirname(new URL(import.meta.url).pathname);
const PROTOCOL_WIT =
  process.env.CAPSULE_PROTOCOL_WIT ??
  path.resolve(DIST_DIR, "../protocol/wit");

/**
 * Build the capsule artifacts (app.wasm + manifest + concatenated migrations) into `.capsule/build`.
 *
 * - JS: esbuild bundle -> `jco componentize` against the CEP world.
 * - Python: `componentize-py` against the CEP world.
 */
export async function build(projectDir: string, cfg: CapsuleConfig): Promise<BuildResult> {
  const outDir = path.join(projectDir, ".capsule", "build");
  await fs.mkdir(outDir, { recursive: true });

  const wasmPath = path.join(outDir, "app.wasm");
  const manifestPath = path.join(outDir, "capsule.manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(deriveManifest(cfg), null, 2));

  if (cfg.runtime === "js") {
    await buildJs(projectDir, cfg, outDir, wasmPath);
  } else {
    await buildPython(projectDir, cfg, wasmPath);
  }

  // Concatenate migrations into a single SQL file consumed by the runtime.
  let migrationsPath: string | undefined;
  if (cfg.database.enabled && cfg.database.migrations) {
    migrationsPath = await concatMigrations(path.join(projectDir, cfg.database.migrations), outDir);
  }

  return { outDir, wasmPath, manifestPath, migrationsPath };
}

async function buildJs(projectDir: string, cfg: CapsuleConfig, outDir: string, wasmPath: string) {
  const entry = path.join(projectDir, cfg.entrypoint);
  const bundle = path.join(outDir, "bundle.js");
  // 1) bundle
  await run("npx", ["esbuild", entry, "--bundle", "--format=esm", `--outfile=${bundle}`], projectDir);
  // 2) componentize against the CEP world
  await run(
    "npx",
    ["jco", "componentize", bundle, "--wit", PROTOCOL_WIT, "--world-name", "capsule", "-o", wasmPath],
    projectDir,
  );
}

async function buildPython(projectDir: string, cfg: CapsuleConfig, wasmPath: string) {
  // `app` module is the package containing def handle(req)
  const moduleName = path.basename(path.dirname(path.join(projectDir, cfg.entrypoint)));
  await run(
    "componentize-py",
    ["-d", PROTOCOL_WIT, "-w", "capsule", "componentize", moduleName, "-o", wasmPath],
    projectDir,
  );
}

async function concatMigrations(dir: string, outDir: string): Promise<string> {
  const files = (await fs.readdir(dir).catch(() => []))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let sql = "";
  for (const f of files) {
    sql += `-- ${f}\n` + (await fs.readFile(path.join(dir, f), "utf8")) + "\n";
  }
  const out = path.join(outDir, "migrations.sql");
  await fs.writeFile(out, sql, "utf8");
  return out;
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`)),
    );
  });
}
