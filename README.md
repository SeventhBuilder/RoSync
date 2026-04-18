# RoSync

RoSync is an open-source, bidirectional sync stack for Roblox Studio and Visual Studio Code.

This repository is being rebuilt around the architecture in `ROSYNC_AGENT_PROMPT.md`. The current target shape is:

- `daemon/`: the RoSync CLI daemon and sync server
- `plugin/`: the Roblox Studio plugin
- `extension/`: the VS Code extension
- `docs/`: Docusaurus-compatible documentation
- `install/`: cross-platform installer scripts

## Current Status

The fresh implementation starts with a new TypeScript daemon foundation:

- `rosync init`
- `rosync watch`
- `rosync status`
- `rosync doctor`
- `rosync schema update`
- `rosync push`
- `rosync pull`
- `rosync update`
- `rosync uninstall`

The daemon now owns the new config, schema cache, ignore parsing, filesystem-backed project tree, HTTP/WebSocket runtime, and project bootstrap flow.

## Implemented Foundation

- Filesystem-backed project tree under a configured project `src/<Service>/<Instance>/`
- `.instance.json` discovery and script file detection
- HTTP endpoints for health, status, schema, tree, and instance mutations
- WebSocket handshake plus basic instance add/change/remove/rename handling
- VS Code extension views for Explorer, Properties, and Status
- Studio plugin modules for daemon health checks, WebSocket connection, and change forwarding

## Why TypeScript

The prompt recommends Rust or Node.js. This environment has Node.js available but does not have Rust tooling installed, so the rebuild starts with a TypeScript implementation that is cross-platform and easy to iterate on locally.

That decision is documented in [ARCHITECTURE.md](ARCHITECTURE.md).

## Workspace Layout

```text
.
├── daemon/
├── docs/
├── examples/
├── extension/
├── install/
├── plugin/
├── ARCHITECTURE.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
└── TESTING.md
```

## Legacy Prototype

Older prototype folders remain in the workspace during the rebuild so we do not destroy existing work unexpectedly. They are not the target architecture going forward.

## Dev Project

The repository root is now tool source only. The dogfood RoSync project used for local extension and daemon development lives under `examples/dev-project/`.

## Development

```bash
npm install
npm run build
npm run test
```

## Windows Local Install

For a quick Windows setup that installs the Studio plugin into Roblox and creates a local CLI shim, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install\windows\install.ps1
```

For macOS and Linux source installs:

```bash
bash install/macos/install.sh
bash install/linux/install.sh
```

Each installer writes install metadata to the platform-local RoSync meta directory so `rosync update` and `rosync uninstall` can find the linked source checkout later. The current source installers keep the checkout in place on uninstall instead of deleting the repository you installed from.

Run the daemon against the bundled dev project:

```bash
cd examples/dev-project
node ../../node_modules/tsx/dist/cli.mjs ../../daemon/src/main.ts watch
```

From another shell, inspect the daemon:

```bash
cd examples/dev-project
node ../../node_modules/tsx/dist/cli.mjs ../../daemon/src/main.ts status
```
