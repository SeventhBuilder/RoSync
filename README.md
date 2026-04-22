# RoSync

> Bidirectional live sync between Roblox Studio and Visual Studio Code.

RoSync keeps your Roblox Studio DataModel and your local file system in sync — in real time, in both directions. Edit a script in VSCode and see it update in Studio instantly. Add a Part in Studio and see the `.instance.json` appear on disk. Everything syncs — not just scripts, but Parts, Models, GUIs, RemoteEvents, Configurations, and every other Roblox instance class.

Built on TypeScript, runs entirely on localhost. No cloud, no relay server.

---

## Features

- **Two-way live sync** — changes in Studio appear on disk; changes on disk appear in Studio
- **Everything syncs** — Scripts, Parts, Models, GUIs, RemoteEvents, Sounds, Animations, and any instance class Roblox supports
- **ReflectionService-driven** — property discovery uses Roblox's own API, so new instance types are supported automatically without any RoSync update
- **Localhost only** — all traffic stays on `127.0.0.1:34872`, nothing leaves your machine
- **VSCode Explorer** — browse your full Roblox DataModel tree inside VSCode with Roblox-style class icons
- **Multi-place support** — manage multiple Roblox places in one project
- **Git integration** — auto-commit sync events, track changes over time
- **Cross-platform** — Windows, Mac, and Linux

---

## Installation

### Prerequisites
- [Git](https://git-scm.com)
- [Node.js 18+](https://nodejs.org)
- [Visual Studio Code](https://code.visualstudio.com)
- Roblox Studio

### Windows
```powershell
git clone https://github.com/SeventhBuilder/RoSync.git
cd RoSync
powershell -ExecutionPolicy Bypass -File .\install\windows\install.ps1
```

### Mac
```bash
git clone https://github.com/SeventhBuilder/RoSync.git
cd RoSync
bash install/Mac/install.sh
```

### Linux
```bash
git clone https://github.com/SeventhBuilder/RoSync.git
cd RoSync
bash install/linux/install.sh
```

The source installer builds RoSync, adds `rosync` to your PATH, copies the Roblox Studio plugin into the local plugins folder, and installs the unpacked RoSync VS Code extension into your local extensions directory. If a local Cursor profile already exists, the same unpacked extension is copied there too.

After install, reload or restart VS Code / Cursor so the newly copied extension is picked up.

---

## Quick Start

```bash
# Create a new RoSync project in your game folder
mkdir my-game && cd my-game
rosync init

# Start the sync daemon
rosync watch
```

Then in Roblox Studio:
1. Open the **RoSync plugin** (Plugins → RoSync)
2. Click **Connect**
3. The status indicator turns 🟢 — you're live

Changes in Studio now sync to `src/` on disk. Changes to files in VSCode sync back to Studio.

The Studio plugin now includes a scrollable **Sync Activity** feed instead of a plain text log. Mutation rows are source-labeled and color-coded:

- `[Studio] + Add Workspace/Part`
- `[VSCode] ~ Update ServerScriptService/GameManager`
- `[Studio] - Remove ReplicatedStorage/OldEvent`

`rosync watch` mirrors the same high-level mutations in the terminal with green `+ Add`, yellow `~ Update` / `~ Rename`, and red `- Remove` action tokens.

---

## CLI Reference

| Command | Description |
|---|---|
| `rosync init` | Scaffold a new RoSync project |
| `rosync watch` | Start the live sync daemon |
| `rosync push` | Force-push local files to Studio |
| `rosync pull` | Force-pull Studio state to disk |
| `rosync status` | Show sync state, connections, drift |
| `rosync doctor` | Diagnose connection and config issues |
| `rosync schema update` | Fetch the latest Roblox API schema |
| `rosync place list/add/switch` | Manage multiple Roblox places |
| `rosync git init/commit/diff` | Git integration commands |
| `rosync update` | Update RoSync to the latest version |
| `rosync uninstall` | Remove RoSync from your system |

---

## Project Structure

Once synced, your game lives on disk like this:

```
src/
  Workspace/
    Baseplate/
      .instance.json        ← instance class + properties
  ServerScriptService/
    GameManager/
      .instance.json
      init.server.luau      ← script source
  ReplicatedStorage/
    MyModule/
      init.luau
```

---

## Repository Layout

```
.
├── daemon/       TypeScript CLI daemon and sync server
├── plugin/       Roblox Studio plugin (Luau)
├── extension/    VSCode extension
├── install/      Cross-platform installer scripts
├── docs/         Documentation (Docusaurus)
└── examples/     Dev project for local testing
```

---

## Development

```bash
npm install
npm run build
npm run test
```

To run the daemon against the example project:

```bash
cd examples/dev-project
node ../../node_modules/tsx/dist/cli.mjs ../../daemon/src/main.ts watch
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
