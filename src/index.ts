#!/usr/bin/env node
import { Command } from "commander";
import kleur from "kleur";

import { initCommand } from "./commands/init.js";
import { loginCommand } from "./commands/login.js";
import { runCommand } from "./commands/run.js";
import { buildCommand } from "./commands/build.js";
import { deployCommand } from "./commands/deploy.js";
import {
  localDeployCommand,
  localListCommand,
  localRemoveCommand,
} from "./commands/local.js";

const program = new Command();

program
  .name("capsule")
  .description("The serverless runtime for AI agents & full-stack apps")
  .version("0.1.0");

program
  .command("init")
  .description("Create a capsule.json in the current directory")
  .option("-n, --name <name>", "project name")
  .option("-t, --type <type>", "agent | platform")
  .option("-r, --runtime <runtime>", "js | python")
  .option("-y, --yes", "accept defaults")
  .action(async (opts) => guard(() => initCommand(opts)));

program
  .command("login")
  .description("Authenticate the CLI with Capsule Cloud")
  .option("--token <token>", "set the API token directly")
  .option("--api-url <url>", "override the API base URL")
  .action(async (opts) => guard(() => loginCommand(opts)));

program
  .command("run")
  .description("Run the capsule locally")
  .option("-X, --method <method>", "HTTP method", "GET")
  .option("-p, --path <path>", "request path", "/")
  .option("-b, --body <body>", "request body (raw string)")
  .option("--json", "output the raw JSON result")
  .action(async (opts) => guard(() => runCommand(opts)));

program
  .command("build")
  .description("Build the capsule artifacts into .capsule/build")
  .option("-o, --out <dir>", "output directory")
  .action(async (opts) => guard(() => buildCommand(opts)));

program
  .command("deploy [source]")
  .description("Build and deploy the capsule to Capsule Cloud")
  .option("-m, --message <msg>", "deployment message")
  .option("--prod", "production deployment", true)
  .option("--repo <url>", "deploy from a Git repository URL")
  .option("--name <name>", "project name when capsule.json is not present")
  .option("--type <type>", "agent | platform")
  .option("--runtime <runtime>", "js | python")
  .option("--prebuilt", "build locally and upload app.wasm instead of source")
  .action(async (source, opts) => guard(() => deployCommand(source, opts)));

const local = program.command("local").description("Run free, Docker-like isolated local instances");

local
  .command("deploy [source]")
  .alias("up")
  .description("Deploy a capsule as an isolated local HTTP instance")
  .option("--name <name>", "local instance name")
  .option("--type <type>", "agent | platform")
  .option("--runtime <runtime>", "js | python")
  .option("--host <host>", "bind host", "127.0.0.1")
  .option("-p, --port <port>", "bind port", "8787")
  .option("--adapter <adapter>", "auto | wasm | frontend | static", "auto")
  .option("--command <command>", "custom frontend command; supports {host}, {port}, {url}")
  .action(async (source, opts) => guard(() => localDeployCommand(source, opts)));

local
  .command("ps")
  .description("List local capsule instances")
  .action(async () => guard(() => localListCommand()));

local
  .command("rm <name>")
  .description("Remove local capsule instance data")
  .option("-f, --force", "remove even if the instance appears to be running")
  .action(async (name, opts) => guard(() => localRemoveCommand(name, opts)));

program
  .command("up [source]")
  .description("Alias for capsule local deploy")
  .option("--name <name>", "local instance name")
  .option("--type <type>", "agent | platform")
  .option("--runtime <runtime>", "js | python")
  .option("--host <host>", "bind host", "127.0.0.1")
  .option("-p, --port <port>", "bind port", "8787")
  .option("--adapter <adapter>", "auto | wasm | frontend | static", "auto")
  .option("--command <command>", "custom frontend command; supports {host}, {port}, {url}")
  .action(async (source, opts) => guard(() => localDeployCommand(source, opts)));

program.parseAsync(process.argv);

async function guard(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(kleur.red("error: ") + (e as Error).message);
    process.exit(1);
  }
}
