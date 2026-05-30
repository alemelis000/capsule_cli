import { createWriteStream, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type archiverType from "archiver";

const require = createRequire(import.meta.url);
const archiver = require("archiver") as typeof archiverType;

export interface SourceFilePayload {
  name: string;
  content_b64: string;
}

export interface SourcePayload {
  source_zip_b64?: string;
  source_file?: SourceFilePayload;
}

const DEFAULT_EXCLUDES = new Set([
  ".git",
  ".capsule",
  "node_modules",
  "target",
  "dist",
  ".next",
  ".turbo",
  "__pycache__",
  ".venv",
  "venv",
]);

export async function sourcePayload(sourcePath: string): Promise<SourcePayload> {
  const full = path.resolve(sourcePath);
  const stat = await fs.stat(full).catch(() => {
    throw new Error(`source not found: ${sourcePath}`);
  });

  if (stat.isFile()) {
    return {
      source_file: {
        name: path.basename(full),
        content_b64: (await fs.readFile(full)).toString("base64"),
      },
    };
  }

  if (!stat.isDirectory()) {
    throw new Error(`source must be a file or directory: ${sourcePath}`);
  }

  const zip = await zipDirectory(full);
  return { source_zip_b64: zip.toString("base64") };
}

async function zipDirectory(dir: string): Promise<Buffer> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-src-"));
  const out = path.join(tmp, "source.zip");

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(out);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    archive.on("warning", reject);
    archive.on("error", reject);
    archive.pipe(output);

    archive.glob("**/*", {
      cwd: dir,
      dot: true,
      ignore: [...DEFAULT_EXCLUDES].flatMap((name) => [name, `${name}/**`, `**/${name}`, `**/${name}/**`]),
    });
    void archive.finalize();
  });

  try {
    return await fs.readFile(out);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
