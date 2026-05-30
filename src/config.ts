import { z } from "zod";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Schema for a project's `capsule.json`. */
export const CapsuleConfigSchema = z.object({
  $schema: z.string().optional(),
  name: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/, "name must match [a-z0-9-], 1..40 chars"),
  type: z.enum(["agent", "platform"]).default("agent"),
  runtime: z.enum(["js", "python"]).default("js"),
  entrypoint: z.string().default("src/index.js"),
  frontend: z
    .object({
      dir: z.string(),
      build: z.string().optional(),
      output: z.string(),
    })
    .optional(),
  database: z
    .object({
      enabled: z.boolean().default(false),
      vector: z.boolean().default(false),
      migrations: z.string().optional(),
    })
    .default({ enabled: false, vector: false }),
  network: z
    .object({
      enabled: z.boolean().default(false),
      allowedDomains: z.array(z.string()).default([]),
    })
    .default({ enabled: false, allowedDomains: [] }),
  limits: z
    .object({
      timeoutMs: z.number().int().min(100).max(30000).default(2000),
      maxMemoryMb: z.number().int().min(16).max(512).default(64),
    })
    .default({ timeoutMs: 2000, maxMemoryMb: 64 }),
  env: z.array(z.string()).default([]),
});

export type CapsuleConfig = z.infer<typeof CapsuleConfigSchema>;

/** The effective manifest the runtime consumes. */
export interface Manifest {
  protocol_version: string;
  runtime: "js" | "python";
  type: "agent" | "platform";
  capabilities: {
    database: { enabled: boolean; vector: boolean; write: boolean };
    network: { enabled: boolean; allowed_domains: string[] };
  };
  limits: { timeout_ms: number; max_memory_mb: number };
  env_keys: string[];
}

const CONFIG_FILE = "capsule.json";

export async function readCapsuleConfig(dir = process.cwd()): Promise<CapsuleConfig> {
  const file = path.join(dir, CONFIG_FILE);
  const raw = await fs.readFile(file, "utf8").catch(() => {
    throw new Error(`No ${CONFIG_FILE} found in ${dir}. Run \`capsule init\` first.`);
  });
  const parsed = CapsuleConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Invalid ${CONFIG_FILE}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  if (parsed.data.frontend && parsed.data.type !== "platform") {
    throw new Error("`frontend` is only allowed when type=platform");
  }
  if (parsed.data.database.vector && !parsed.data.database.enabled) {
    throw new Error("database.vector requires database.enabled");
  }
  return parsed.data;
}

export async function writeCapsuleConfig(dir: string, cfg: CapsuleConfig): Promise<void> {
  await fs.writeFile(path.join(dir, CONFIG_FILE), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

/** Derive the runtime manifest from a project config (local case). */
export function deriveManifest(cfg: CapsuleConfig): Manifest {
  return {
    protocol_version: "1.0.0",
    runtime: cfg.runtime,
    type: cfg.type,
    capabilities: {
      database: {
        enabled: cfg.database.enabled,
        vector: cfg.database.vector,
        write: cfg.database.enabled,
      },
      network: {
        enabled: cfg.network.enabled,
        allowed_domains: cfg.network.allowedDomains,
      },
    },
    limits: {
      timeout_ms: cfg.limits.timeoutMs,
      max_memory_mb: cfg.limits.maxMemoryMb,
    },
    env_keys: cfg.env,
  };
}

/** Global CLI config (~/.capsule/config.json). */
export const GlobalConfigSchema = z.object({
  token: z.string().optional(),
  apiUrl: z.string().default("https://api.capsule.dev"),
});
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export function globalConfigDir(): string {
  return path.join(homedir(), ".capsule");
}

export async function readGlobalConfig(): Promise<GlobalConfig> {
  const file = path.join(globalConfigDir(), "config.json");
  const raw = await fs.readFile(file, "utf8").catch(() => "{}");
  return GlobalConfigSchema.parse(JSON.parse(raw));
}

export async function writeGlobalConfig(cfg: GlobalConfig): Promise<void> {
  const dir = globalConfigDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "config.json"), JSON.stringify(cfg, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}
