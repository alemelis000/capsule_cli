import path from "node:path";
import kleur from "kleur";

import { deriveManifest, readCapsuleConfig } from "../config.js";
import { build } from "../build.js";
import { invokeRuntime } from "../runtime.js";

export interface RunOptions {
  method: string;
  path: string;
  body?: string;
  json?: boolean;
}

export async function runCommand(opts: RunOptions): Promise<void> {
  const dir = process.cwd();
  const cfg = await readCapsuleConfig(dir);
  const manifest = deriveManifest(cfg);

  if (!opts.json) console.log(kleur.gray("building…"));
  const artifacts = await build(dir, cfg);

  // Local persistent DB so state survives between runs (mock R2).
  const dbPath = cfg.database.enabled
    ? path.join(dir, ".capsule", "db", `${cfg.name}.db`)
    : undefined;
  if (dbPath) {
    await (await import("node:fs")).promises.mkdir(path.dirname(dbPath), { recursive: true });
  }

  const result = await invokeRuntime({
    manifest,
    wasmPath: artifacts.wasmPath,
    dbPath,
    migrationsPath: artifacts.migrationsPath,
    http: {
      method: opts.method,
      path: opts.path,
      headers: [],
      body: opts.body ? Buffer.from(opts.body).toString("base64") : undefined,
    },
    env: collectEnv(cfg.env),
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const line of result.logs) {
    const color = line.level === "stderr" || line.level === "error" ? kleur.red : kleur.gray;
    console.log(color(`[${line.level}] ${line.message}`));
  }
  console.log();
  console.log(kleur.bold(`outcome: ${result.outcome.kind}`));
  console.log(`status:  ${result.http.status}`);
  const body = Buffer.from(result.http.body, "base64").toString("utf8");
  if (body) console.log("body:    " + body);
  console.log(
    kleur.gray(
      `metrics: ${result.metrics.compute_ms}ms, ${result.metrics.db_queries} db, ${result.metrics.net_calls} net`,
    ),
  );
}

function collectEnv(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    if (process.env[k]) out[k] = process.env[k] as string;
  }
  return out;
}
