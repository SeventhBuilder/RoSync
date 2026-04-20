# RoSync Studio Plugin

This folder contains the new RoSync Studio plugin source tree.

The current foundation scaffolds the DockWidget entry point and the module layout from the target architecture so the implementation can grow cleanly:

- `src/main.client.luau`
- `src/ui/`
- `src/network/`
- `src/sync/`
- `src/util/`

The legacy single-file prototype still exists elsewhere in the repo during the migration, but this folder is the new source of truth.

## Installation

For a local Windows dev install, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install\windows\install.ps1
```

That will:

- build the daemon and editor extension foundation
- bundle `plugin/RoSync.plugin.luau`
- copy the plugin into `%LOCALAPPDATA%\Roblox\Plugins\RoSync.plugin.lua`
- create a local CLI shim at `%LOCALAPPDATA%\RoSync\bin\rosync.cmd`

For Unix shells, the install scripts can be run from either `bash` or `zsh`:

```bash
bash install/linux/install.sh
zsh install/linux/install.sh
bash install/macos/install.sh
zsh install/macos/install.sh
```

## Build A Testable Plugin File

You can generate a single-file plugin script for Roblox Studio with:

```bash
sh plugin/build.sh
```

That writes:

- `plugin/RoSync.plugin.luau`

To test the current foundation in Studio:

1. Run `rosync watch` in your test project folder
2. Open Roblox Studio
3. Open the RoSync plugin
4. Connect to `http://127.0.0.1:34872`

The plugin dashboard now has eight actions across two rows:

- `Connect`
- `Start Watch`
- `Push All`
- `Pull All`
- `Push Selection`
- `Status`
- `Refresh`
- `Disconnect`

The bottom panel is a real scrollable **Sync Activity** feed. It shows:

- green `+ Add`
- yellow `~ Update` and `~ Rename`
- red `- Remove`
- source labels like `[Studio]`, `[VSCode]`, and `[Disk]`

The same mutation summaries are also mirrored into Studio Output for debugging.
