import kleur from "kleur";

import { readCapsuleConfig } from "../config.js";
import { build } from "../build.js";

export interface BuildOptions {
  out?: string;
}

export async function buildCommand(_opts: BuildOptions): Promise<void> {
  const dir = process.cwd();
  const cfg = await readCapsuleConfig(dir);
  const t0 = Date.now();
  const artifacts = await build(dir, cfg);
  const ms = Date.now() - t0;
  console.log(kleur.green("✓") + ` Built in ${ms}ms`);
  console.log(kleur.gray("  wasm:     ") + artifacts.wasmPath);
  console.log(kleur.gray("  manifest: ") + artifacts.manifestPath);
  if (artifacts.migrationsPath) console.log(kleur.gray("  migrations: ") + artifacts.migrationsPath);
}
