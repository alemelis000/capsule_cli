import { promises as fs } from "node:fs";
import path from "node:path";
import kleur from "kleur";

import { CapsuleConfig, readCapsuleConfig } from "../config.js";
import { build } from "../build.js";
import { ApiClient, Project } from "../api.js";
import { sourcePayload } from "../source.js";

export interface DeployOptions {
  message?: string;
  prod?: boolean;
  repo?: string;
  name?: string;
  type?: "agent" | "platform";
  runtime?: "js" | "python";
  prebuilt?: boolean;
}

export async function deployCommand(source: string | undefined, opts: DeployOptions): Promise<void> {
  const dir = process.cwd();
  const cfg = await projectConfig(dir, source, opts);

  const api = await ApiClient.fromConfig();

  // Find or create the project.
  let project: Project | undefined;
  try {
    const projects = await api.listProjects();
    project = projects.find((p) => p.slug === cfg.name);
  } catch {
    // not logged in / API down — surface a clear message below
  }
  if (!project) {
    project = await api.createProject({
      name: cfg.name,
      type: cfg.type,
      runtime: cfg.runtime,
      repo_url: opts.repo,
    });
  }

  const deploymentInput = await createDeploymentInput(dir, cfg, source, opts);

  console.log(kleur.gray("deploying…"));
  const deployment = await api.createDeployment(project.id, {
    ...deploymentInput,
    commit_message: opts.message ?? "deploy via CLI",
  });

  const url =
    cfg.type === "platform"
      ? `https://${project.slug}.capsule.app`
      : `https://${project.slug}.capsule.app/  (POST your webhook here)`;

  console.log(kleur.green("✓") + ` Deployed (${deployment.status})`);
  console.log(kleur.bold(url));
}

async function projectConfig(
  dir: string,
  source: string | undefined,
  opts: DeployOptions,
): Promise<CapsuleConfig> {
  const config = await readCapsuleConfig(dir).catch(() => undefined);
  if (config) {
    return {
      ...config,
      name: opts.name ?? config.name,
      type: opts.type ?? config.type,
      runtime: opts.runtime ?? config.runtime,
    };
  }

  const inferredRuntime = opts.runtime ?? inferRuntime(source ?? dir);
  const inferredName = opts.name ?? inferName(source ?? dir);
  return {
    $schema: "https://capsule.dev/schema/v1.json",
    name: inferredName,
    type: opts.type ?? "agent",
    runtime: inferredRuntime,
    entrypoint: inferredRuntime === "python" ? "app/__init__.py" : "src/index.js",
    database: { enabled: true, vector: false },
    network: { enabled: false, allowedDomains: [] },
    limits: { timeoutMs: 2000, maxMemoryMb: 64 },
    env: [],
  };
}

async function createDeploymentInput(
  dir: string,
  cfg: CapsuleConfig,
  source: string | undefined,
  opts: DeployOptions,
) {
  if (opts.repo) {
    return { use_repo: true };
  }

  if (opts.prebuilt) {
    console.log(kleur.gray("building locally…"));
    const artifacts = await build(dir, cfg);
    const wasm = await fs.readFile(artifacts.wasmPath);
    return { artifact_b64: wasm.toString("base64") };
  }

  const target = source ?? dir;
  console.log(kleur.gray(`uploading source ${path.relative(dir, path.resolve(target)) || "."}…`));
  return sourcePayload(target);
}

function inferRuntime(source: string): "js" | "python" {
  const ext = path.extname(source).toLowerCase();
  return ext === ".py" ? "python" : "js";
}

function inferName(source: string): string {
  const parsed = path.parse(path.resolve(source));
  const raw = parsed.ext ? parsed.name : parsed.base;
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "capsule";
}
