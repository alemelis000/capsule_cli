import { createServer, type IncomingHttpHeaders } from "node:http";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import kleur from "kleur";

import {
  CapsuleConfig,
  CapsuleConfigSchema,
  deriveManifest,
  globalConfigDir,
  readCapsuleConfig,
} from "../config.js";
import { build } from "../build.js";
import { invokeRuntime } from "../runtime.js";

export interface LocalDeployOptions {
  name?: string;
  type?: "agent" | "platform";
  runtime?: "js" | "python";
  host?: string;
  port?: string;
  adapter?: "auto" | "wasm" | "frontend" | "static";
  command?: string;
}

export interface LocalRemoveOptions {
  force?: boolean;
}

interface PreparedProject {
  dir: string;
  config: CapsuleConfig;
  cleanup?: () => Promise<void>;
}

interface InstanceMetadata {
  name: string;
  type: string;
  runtime: string;
  source: string;
  url: string;
  port: number;
  pid: number;
  updatedAt: string;
}

interface FrontendInstance {
  dir: string;
  name: string;
  kind: string;
  command: string;
}

interface StaticInstance {
  dir: string;
  name: string;
}

export async function localDeployCommand(
  source: string | undefined,
  opts: LocalDeployOptions,
): Promise<void> {
  const host = opts.host ?? "127.0.0.1";
  const port = Number.parseInt(opts.port ?? "8787", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be a valid TCP port");
  }

  const localTarget = path.resolve(source ?? process.cwd());
  const staticInstance = await detectStaticInstance(localTarget, opts);
  if (staticInstance && opts.adapter === "static") {
    await runStaticInstance(staticInstance, opts, host, port, source);
    return;
  }

  const frontendInstance = await detectFrontendInstance(localTarget, opts, host, port);
  if (frontendInstance) {
    await runFrontendInstance(frontendInstance, opts, host, port, source);
    return;
  }

  if (staticInstance && opts.adapter !== "wasm") {
    await runStaticInstance(staticInstance, opts, host, port, source);
    return;
  }

  const prepared = await prepareProject(source ?? process.cwd(), opts);
  try {
    const name = opts.name ?? prepared.config.name;
    const instanceDir = path.join(instancesDir(), name);
    const artifactDir = path.join(instanceDir, "current");
    const dbPath = prepared.config.database.enabled ? path.join(instanceDir, "state.db") : undefined;

    await fs.mkdir(artifactDir, { recursive: true });
    console.log(kleur.gray(`building isolated instance ${name}...`));
    const artifacts = await build(prepared.dir, prepared.config);

    const wasmPath = path.join(artifactDir, "app.wasm");
    const manifestPath = path.join(artifactDir, "capsule.manifest.json");
    const migrationsPath = artifacts.migrationsPath
      ? path.join(artifactDir, "migrations.sql")
      : undefined;

    await fs.copyFile(artifacts.wasmPath, wasmPath);
    await fs.copyFile(artifacts.manifestPath, manifestPath);
    if (artifacts.migrationsPath && migrationsPath) {
      await fs.copyFile(artifacts.migrationsPath, migrationsPath);
    }

    if (dbPath) await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const manifest = deriveManifest(prepared.config);
    const url = `http://${host}:${port}`;
    await writeInstanceMetadata(instanceDir, {
      name,
      type: prepared.config.type,
      runtime: prepared.config.runtime,
      source: path.resolve(source ?? process.cwd()),
      url,
      port,
      pid: process.pid,
      updatedAt: new Date().toISOString(),
    });

    const server = createServer(async (req, res) => {
      try {
        const body = await readBody(req);
        const result = await invokeRuntime({
          manifest,
          wasmPath,
          dbPath,
          migrationsPath,
          http: {
            method: req.method ?? "GET",
            path: req.url ?? "/",
            headers: requestHeaders(req.headers),
            body: body.length > 0 ? body.toString("base64") : undefined,
          },
          env: collectEnv(prepared.config.env),
        });

        res.statusCode = result.http.status;
        for (const [key, value] of result.http.headers) {
          if (!res.hasHeader(key)) res.setHeader(key, value);
        }
        res.end(Buffer.from(result.http.body, "base64"));
      } catch (e) {
        res.statusCode = 500;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end(`capsule local runtime error: ${(e as Error).message}`);
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    });

    console.log(kleur.green("✓") + ` Local instance ${kleur.bold(name)} is running`);
    console.log(kleur.gray("  url:      ") + kleur.cyan(url));
    console.log(kleur.gray("  data:     ") + instanceDir);
    console.log(kleur.gray("  stop:     ") + "Ctrl+C");

    await new Promise<void>((resolve) => {
      const shutdown = () => server.close(() => resolve());
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
  } finally {
    await prepared.cleanup?.();
  }
}

async function runFrontendInstance(
  instance: FrontendInstance,
  _opts: LocalDeployOptions,
  host: string,
  port: number,
  source: string | undefined,
): Promise<void> {
  const instanceDir = path.join(instancesDir(), instance.name);
  const url = `http://${host}:${port}`;
  await fs.mkdir(instanceDir, { recursive: true });

  const command = instance.command
    .replaceAll("{host}", host)
    .replaceAll("{port}", String(port))
    .replaceAll("{url}", url);

  console.log(kleur.gray(`starting ${instance.kind} frontend instance ${instance.name}...`));
  console.log(kleur.gray("  command:  ") + command);

  const child = spawn(command, {
    cwd: instance.dir,
    shell: true,
    stdio: "inherit",
    env: {
      ...process.env,
      BROWSER: "none",
      HOST: host,
      PORT: String(port),
    },
  });

  await writeInstanceMetadata(instanceDir, {
    name: instance.name,
    type: "frontend",
    runtime: instance.kind,
    source: path.resolve(source ?? process.cwd()),
    url,
    port,
    pid: child.pid ?? process.pid,
    updatedAt: new Date().toISOString(),
  });

  console.log(kleur.green("✓") + ` Local frontend ${kleur.bold(instance.name)} is starting`);
  console.log(kleur.gray("  url:      ") + kleur.cyan(url));
  console.log(kleur.gray("  data:     ") + instanceDir);
  console.log(kleur.gray("  stop:     ") + "Ctrl+C");

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code && code !== 0) reject(new Error(`frontend command exited with ${code}`));
      else resolve();
    });
    const shutdown = () => {
      if (!child.killed) child.kill();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function runStaticInstance(
  instance: StaticInstance,
  _opts: LocalDeployOptions,
  host: string,
  port: number,
  source: string | undefined,
): Promise<void> {
  const instanceDir = path.join(instancesDir(), instance.name);
  const url = `http://${host}:${port}`;
  await fs.mkdir(instanceDir, { recursive: true });

  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", url).pathname);
    const requested = path.normalize(path.join(instance.dir, pathname));
    const root = path.resolve(instance.dir);
    if (!requested.startsWith(root)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    const file = await resolveStaticFile(requested, root);
    if (!file) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    res.setHeader("content-type", contentType(file));
    res.end(await fs.readFile(file));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  await writeInstanceMetadata(instanceDir, {
    name: instance.name,
    type: "frontend",
    runtime: "static",
    source: path.resolve(source ?? process.cwd()),
    url,
    port,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  });

  console.log(kleur.green("✓") + ` Local static frontend ${kleur.bold(instance.name)} is running`);
  console.log(kleur.gray("  url:      ") + kleur.cyan(url));
  console.log(kleur.gray("  root:     ") + instance.dir);
  console.log(kleur.gray("  data:     ") + instanceDir);
  console.log(kleur.gray("  stop:     ") + "Ctrl+C");

  await new Promise<void>((resolve) => {
    const shutdown = () => server.close(() => resolve());
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

export async function localListCommand(): Promise<void> {
  const dir = instancesDir();
  const entries = await fs.readdir(dir).catch(() => []);
  if (entries.length === 0) {
    console.log("No local capsule instances found.");
    return;
  }

  for (const entry of entries) {
    const metadata = await readInstanceMetadata(path.join(dir, entry)).catch(() => undefined);
    if (!metadata) continue;
    const status = isPidRunning(metadata.pid) ? kleur.green("running") : kleur.gray("stopped");
    console.log(`${kleur.bold(metadata.name)}  ${status}  ${metadata.url}  ${metadata.runtime}/${metadata.type}`);
  }
}

export async function localRemoveCommand(name: string, opts: LocalRemoveOptions): Promise<void> {
  const dir = path.join(instancesDir(), name);
  const metadata = await readInstanceMetadata(dir).catch(() => undefined);
  if (metadata && isPidRunning(metadata.pid) && !opts.force) {
    throw new Error(`instance ${name} appears to be running. Stop it first or pass --force.`);
  }

  await fs.rm(dir, { recursive: true, force: true });
  console.log(kleur.green("✓") + ` Removed local instance ${name}`);
}

async function prepareProject(source: string, opts: LocalDeployOptions): Promise<PreparedProject> {
  const full = path.resolve(source);
  const stat = await fs.stat(full).catch(() => {
    throw new Error(`source not found: ${source}`);
  });

  if (stat.isDirectory()) {
    const config = await readCapsuleConfig(full).catch(() =>
      defaultConfig({
        name: opts.name ?? inferName(full),
        runtime: opts.runtime ?? "js",
        type: opts.type ?? "agent",
      }),
    );
    return { dir: full, config: applyOverrides(config, opts) };
  }

  if (!stat.isFile()) {
    throw new Error(`source must be a file or directory: ${source}`);
  }

  const runtime = opts.runtime ?? inferRuntime(full);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-local-"));
  const entrypoint = runtime === "python" ? path.join("app", "__init__.py") : path.join("src", "index.js");
  await fs.mkdir(path.dirname(path.join(tmp, entrypoint)), { recursive: true });
  await fs.copyFile(full, path.join(tmp, entrypoint));

  const config = defaultConfig({
    name: opts.name ?? inferName(full),
    runtime,
    type: opts.type ?? "agent",
    entrypoint,
  });

  return {
    dir: tmp,
    config,
    cleanup: () => fs.rm(tmp, { recursive: true, force: true }),
  };
}

async function detectFrontendInstance(
  full: string,
  opts: LocalDeployOptions,
  host: string,
  port: number,
): Promise<FrontendInstance | undefined> {
  if (opts.adapter === "wasm" || opts.adapter === "static") return undefined;

  const stat = await fs.stat(full).catch(() => undefined);
  if (!stat?.isDirectory()) return undefined;

  const packageFile = path.join(full, "package.json");
  const pkg = await readJson<{
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(packageFile);
  if (!pkg && !opts.command) return undefined;

  const name = opts.name ?? sanitizeName(pkg?.name ?? inferName(full));
  if (opts.command) {
    return { dir: full, name, kind: "custom", command: opts.command };
  }

  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const scripts = pkg?.scripts ?? {};
  const command = frameworkCommand(deps, scripts, host, port) ?? scriptCommand(scripts, host, port);
  if (!command) return undefined;

  return { dir: full, name, kind: detectFrontendKind(deps, scripts), command };
}

async function detectStaticInstance(
  full: string,
  opts: LocalDeployOptions,
): Promise<StaticInstance | undefined> {
  if (opts.adapter === "wasm" || opts.command) return undefined;

  const stat = await fs.stat(full).catch(() => undefined);
  if (stat?.isFile() && path.basename(full).toLowerCase().endsWith(".html")) {
    return { dir: path.dirname(full), name: opts.name ?? sanitizeName(path.parse(full).name) };
  }
  if (!stat?.isDirectory()) return undefined;

  const candidates = [path.join(full, "index.html"), path.join(full, "public", "index.html")];
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return {
        dir: path.dirname(candidate),
        name: opts.name ?? sanitizeName(path.basename(full)),
      };
    }
  }
  return undefined;
}

function frameworkCommand(
  deps: Record<string, string>,
  scripts: Record<string, string>,
  host: string,
  port: number,
): string | undefined {
  if (deps.expo || deps["expo-router"]) return `npx expo start --web --port ${port} --host ${host}`;
  if (deps.next) return scriptOrBin(scripts, "dev", "next dev", `-H ${host} -p ${port}`);
  if (deps.vite || deps["@vitejs/plugin-react"] || deps["@vitejs/plugin-vue"]) {
    return scriptOrBin(scripts, "dev", "vite", `--host ${host} --port ${port}`);
  }
  if (deps.astro) return scriptOrBin(scripts, "dev", "astro dev", `--host ${host} --port ${port}`);
  if (deps.nuxt || deps["nuxt3"]) return scriptOrBin(scripts, "dev", "nuxt dev", `--host ${host} --port ${port}`);
  if (deps["@sveltejs/kit"] || deps.svelte) {
    return scriptOrBin(scripts, "dev", "vite dev", `--host ${host} --port ${port}`);
  }
  if (deps["@angular/cli"] || deps["@angular/core"]) return `npx ng serve --host ${host} --port ${port}`;
  if (deps["@ionic/react"] || deps["@ionic/vue"] || deps["@ionic/angular"]) {
    return scriptOrBin(scripts, "start", "ionic serve", `--host ${host} --port ${port}`);
  }
  if (deps["@storybook/react"] || deps.storybook) {
    return scriptOrBin(scripts, "storybook", "storybook dev", `--host ${host} --port ${port}`);
  }
  return undefined;
}

function scriptCommand(
  scripts: Record<string, string>,
  host: string,
  port: number,
): string | undefined {
  const script = ["web", "dev", "start", "serve", "preview", "storybook"].find((name) => scripts[name]);
  if (!script) return undefined;
  return `npm run ${script} -- --host ${host} --port ${port}`;
}

function scriptOrBin(
  scripts: Record<string, string>,
  script: string,
  bin: string,
  args: string,
): string {
  return scripts[script] ? `npm run ${script} -- ${args}` : `npx ${bin} ${args}`;
}

function detectFrontendKind(deps: Record<string, string>, scripts: Record<string, string>): string {
  if (deps.expo || deps["expo-router"]) return "expo";
  if (deps.next) return "next";
  if (deps.vite) return "vite";
  if (deps.astro) return "astro";
  if (deps.nuxt || deps.nuxt3) return "nuxt";
  if (deps["@sveltejs/kit"] || deps.svelte) return "svelte";
  if (deps["@angular/core"]) return "angular";
  if (deps["@ionic/react"] || deps["@ionic/vue"] || deps["@ionic/angular"]) return "ionic";
  if (scripts.storybook || deps.storybook) return "storybook";
  return "frontend";
}

async function resolveStaticFile(requested: string, root: string): Promise<string | undefined> {
  const stat = await fs.stat(requested).catch(() => undefined);
  if (stat?.isFile()) return requested;
  if (stat?.isDirectory() && await exists(path.join(requested, "index.html"))) {
    return path.join(requested, "index.html");
  }
  const fallback = path.join(root, "index.html");
  return (await exists(fallback)) ? fallback : undefined;
}

function contentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function defaultConfig(input: {
  name: string;
  runtime: "js" | "python";
  type: "agent" | "platform";
  entrypoint?: string;
}): CapsuleConfig {
  return CapsuleConfigSchema.parse({
    $schema: "https://capsule.dev/schema/v1.json",
    name: input.name,
    type: input.type,
    runtime: input.runtime,
    entrypoint: input.entrypoint ?? (input.runtime === "python" ? "app/__init__.py" : "src/index.js"),
    database: { enabled: true, vector: false },
    network: { enabled: false, allowedDomains: [] },
    limits: { timeoutMs: 2000, maxMemoryMb: 64 },
    env: [],
  });
}

function applyOverrides(config: CapsuleConfig, opts: LocalDeployOptions): CapsuleConfig {
  return {
    ...config,
    name: opts.name ?? config.name,
    type: opts.type ?? config.type,
    runtime: opts.runtime ?? config.runtime,
  };
}

function instancesDir(): string {
  return path.join(globalConfigDir(), "instances");
}

async function writeInstanceMetadata(dir: string, metadata: InstanceMetadata): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "instance.json"), JSON.stringify(metadata, null, 2) + "\n", "utf8");
}

async function readInstanceMetadata(dir: string): Promise<InstanceMetadata> {
  return JSON.parse(await fs.readFile(path.join(dir, "instance.json"), "utf8")) as InstanceMetadata;
}

function inferRuntime(source: string): "js" | "python" {
  return path.extname(source).toLowerCase() === ".py" ? "python" : "js";
}

function inferName(source: string): string {
  const parsed = path.parse(path.resolve(source));
  const raw = parsed.ext ? parsed.name : parsed.base;
  return sanitizeName(raw);
}

function sanitizeName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "capsule";
}

function collectEnv(keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (process.env[key]) out[key] = process.env[key] as string;
  }
  return out;
}

function requestHeaders(headers: IncomingHttpHeaders): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") out.push([key, value]);
    if (Array.isArray(value)) out.push([key, value.join(", ")]);
  }
  return out;
}

async function readBody(req: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
