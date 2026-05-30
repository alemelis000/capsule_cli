import kleur from "kleur";

import { readGlobalConfig, writeGlobalConfig } from "../config.js";

export interface LoginOptions {
  token?: string;
  apiUrl?: string;
}

export async function loginCommand(opts: LoginOptions): Promise<void> {
  const cfg = await readGlobalConfig();
  if (opts.apiUrl) cfg.apiUrl = opts.apiUrl;

  if (opts.token) {
    cfg.token = opts.token;
    await writeGlobalConfig(cfg);
    console.log(kleur.green("✓") + " Token saved to ~/.capsule/config.json");
    return;
  }

  // Browser-based device login. In this MVP we point the user at the dashboard and accept the
  // pasted token; the production flow uses an OAuth callback / device code.
  const loginUrl = `${cfg.apiUrl.replace("api.", "")}/cli-login`;
  console.log("Open the following URL to authorize the CLI:");
  console.log("  " + kleur.cyan(loginUrl));
  console.log();
  console.log(
    kleur.gray("Then run: ") + kleur.bold("capsule login --token <token>") + kleur.gray(" to store it."),
  );
}
