import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import type { Manifest } from "./config.js";

export interface RunInput {
  manifest: Manifest;
  wasmPath: string;
  workspaceDir?: string;
  dbPath?: string;
  migrationsPath?: string;
  http: {
    method: string;
    path: string;
    headers?: [string, string][];
    body?: string; // base64
  };
  env?: Record<string, string>;
}

export interface RunOutput {
  outcome: { kind: string; reason?: string };
  db_dirty: boolean;
  http: { status: number; headers: [string, string][]; body: string };
  logs: { ts: string; level: string; message: string }[];
  metrics: {
    compute_ms: number;
    fuel_consumed: number;
    mem_peak_bytes: number;
    net_calls: number;
    db_queries: number;
  };
}

/**
 * Locate the `capsule-runtime` binary. Override with CAPSULE_RUNTIME_BIN; otherwise look for a
 * cargo build output relative to the monorepo.
 */
function runtimeBinary(): string {
  if (process.env.CAPSULE_RUNTIME_BIN) return process.env.CAPSULE_RUNTIME_BIN;
  const exe = process.platform === "win32" ? "capsule-runtime.exe" : "capsule-runtime";
  // Try a few common locations relative to this package.
  const here = path.dirname(new URL(import.meta.url).pathname);
  const candidates = [
    path.resolve(here, "../../../target/release", exe),
    path.resolve(here, "../../../target/debug", exe),
  ];
  return candidates.find((c) => existsSync(c)) ?? exe; // fall back to PATH
}

function existsSync(p: string): boolean {
  try {
    require("node:fs").accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Invoke the Rust runtime with a JSON request on stdin, parse the JSON result on stdout. */
export async function invokeRuntime(input: RunInput): Promise<RunOutput> {
  // The manifest is passed as a file (the runtime reads `manifest_path`).
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-run-"));
  const manifestPath = path.join(tmp, "capsule.manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(input.manifest));

  const payload = {
    manifest_path: manifestPath,
    wasm_path: input.wasmPath,
    workspace_dir: input.workspaceDir,
    db_path: input.dbPath,
    migrations_path: input.migrationsPath,
    http: input.http,
    env: input.env ?? {},
  };

  const bin = runtimeBinary();
  return new Promise<RunOutput>((resolve, reject) => {
    const child = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => reject(new Error(`failed to spawn ${bin}: ${e.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`runtime exited with code ${code}: ${err.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(out.trim()) as RunOutput);
      } catch (e) {
        reject(new Error(`could not parse runtime output: ${(e as Error).message}\n${out}`));
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
