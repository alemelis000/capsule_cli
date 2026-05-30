# Capsule CLI

Deploy AI agents and WebAssembly apps to Capsule Cloud from a file, a folder, or a Git repository.

This repository contains the standalone open-core Capsule CLI. It gives developers a local-first
workflow with isolated free instances, plus zero-config deploys to the managed cloud.

Website: [https://capsule.dev](https://capsule.dev)

## Install

```bash
npm install -g capsule-cli
```

Node.js 18 or newer is required.

## Quick Start

Deploy a single Python agent:

```bash
capsule login
capsule deploy ./support-agent.py
```

Deploy the current project directory:

```bash
capsule init
capsule deploy .
```

Run the same agent locally for free, isolated like a lightweight Docker container:

```bash
capsule local deploy ./support-agent.py --port 8787
curl http://127.0.0.1:8787
```

Deploy from a Git repository:

```bash
capsule deploy --repo https://github.com/acme/support-agent
```

After a successful deploy through [capsule.dev](https://capsule.dev), Capsule prints the production
endpoint:

```bash
https://support-agent.capsule.app
```

## Authentication

Interactive login prints the browser authorization URL:

```bash
capsule login
```

For CI or local scripting, pass a token directly:

```bash
capsule login --token cap_xxx
```

Use a different API host when developing against a local or staging control plane:

```bash
capsule login --api-url http://localhost:4000 --token cap_xxx
```

The token is stored in `~/.capsule/config.json`.

## Commands

`capsule init`

Creates `capsule.json` and adds `.capsule/` to `.gitignore`.

`capsule run`

Builds the capsule and runs it locally through the open-source Rust runtime.

```bash
capsule run --method POST --path /webhook --body '{"message":"hello"}'
capsule run --json
```

`capsule local deploy [source]`

Builds and starts a free local HTTP instance, isolated from other instances. This is the
Docker-style local path: no cloud account, no Docker daemon, no billing.

```bash
capsule local deploy ./agent.py --name support-agent --port 8787
capsule local deploy . --name my-app --port 3001
capsule up ./agent.py
```

Each local instance gets its own directory and persistent DB under `~/.capsule/instances/<name>`.
Stop the foreground process with `Ctrl+C`.

`capsule local ps`

Lists local instances and their last known status.

```bash
capsule local ps
```

`capsule local rm <name>`

Removes local instance data.

```bash
capsule local rm support-agent
```

`capsule build`

Builds local artifacts into `.capsule/build`.

```bash
capsule build
```

`capsule deploy [source]`

Uploads source to Capsule Cloud for a zero-config build. `source` can be a file or directory.

```bash
capsule deploy ./agent.py
capsule deploy .
capsule deploy ./apps/support-agent --name support-agent --runtime js
```

Useful options:

- `--repo <url>` deploys from a Git repository URL.
- `--name <name>` sets the project name when no `capsule.json` exists.
- `--type agent|platform` selects the capsule type.
- `--runtime js|python` selects the runtime.
- `--message <msg>` adds a deployment message.
- `--prebuilt` builds locally and uploads `app.wasm` instead of source.

## Project Config

`capsule.json` is optional for simple zero-config deploys, but recommended for repeatable projects.

```json
{
  "$schema": "https://capsule.dev/schema/v1.json",
  "name": "support-agent",
  "type": "agent",
  "runtime": "python",
  "entrypoint": "app/__init__.py",
  "database": { "enabled": true, "vector": false },
  "network": { "enabled": false, "allowedDomains": [] },
  "limits": { "timeoutMs": 2000, "maxMemoryMb": 64 },
  "env": ["OPENAI_API_KEY"]
}
```

## Local Development

From this repository:

```bash
npm install
npm run build
npm run dev -- --help
```

When using `capsule run`, the CLI looks for `capsule-runtime` in the monorepo build output or on
`PATH`. You can override it explicitly:

```bash
CAPSULE_RUNTIME_BIN=/path/to/capsule-runtime capsule run
```

## Release

GitHub Actions builds and tests the CLI on every push. Publishing is designed to run from tags:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow publishes the CLI to npm when `NPM_TOKEN` is configured in GitHub repository
secrets.

## License

MIT.
