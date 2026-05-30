import { promises as fs } from "node:fs";
import path from "node:path";
import kleur from "kleur";

import { CapsuleConfig, CapsuleConfigSchema, writeCapsuleConfig } from "../config.js";

export interface InitOptions {
  name?: string;
  type?: "agent" | "platform";
  runtime?: "js" | "python";
  yes?: boolean;
}

export async function initCommand(opts: InitOptions): Promise<void> {
  const dir = process.cwd();
  const defaultName = path.basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);

  const config: CapsuleConfig = CapsuleConfigSchema.parse({
    $schema: "https://capsule.dev/schema/v1.json",
    name: opts.name ?? defaultName,
    type: opts.type ?? "agent",
    runtime: opts.runtime ?? "js",
    entrypoint: (opts.runtime ?? "js") === "python" ? "app/__init__.py" : "src/index.js",
    database: { enabled: true, vector: false },
    network: { enabled: false, allowedDomains: [] },
    limits: { timeoutMs: 2000, maxMemoryMb: 64 },
    env: [],
  });

  const target = path.join(dir, "capsule.json");
  try {
    await fs.access(target);
    console.log(kleur.yellow(`capsule.json already exists in ${dir} — leaving it untouched.`));
    return;
  } catch {
    // does not exist, proceed
  }

  await writeCapsuleConfig(dir, config);
  await ensureGitignore(dir);

  console.log(kleur.green("✓") + ` Created ${kleur.bold("capsule.json")} (${config.name})`);
  console.log();
  console.log("Next steps:");
  console.log(kleur.gray("  $ ") + "capsule run        " + kleur.gray("# run locally"));
  console.log(kleur.gray("  $ ") + "capsule deploy     " + kleur.gray("# ship to Capsule Cloud"));
}

async function ensureGitignore(dir: string): Promise<void> {
  const file = path.join(dir, ".gitignore");
  const line = ".capsule/";
  let content = await fs.readFile(file, "utf8").catch(() => "");
  if (!content.split("\n").includes(line)) {
    content += (content && !content.endsWith("\n") ? "\n" : "") + line + "\n";
    await fs.writeFile(file, content, "utf8");
  }
}
