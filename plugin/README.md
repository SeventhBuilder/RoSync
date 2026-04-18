# RoSync Studio Plugin

This folder contains the new RoSync Studio plugin source tree.

The current foundation scaffolds the DockWidget entry point and the module layout from the target architecture so the implementation can grow cleanly:

- `src/main.client.luau`
- `src/ui/`
- `src/network/`
- `src/sync/`
- `src/util/`

The legacy single-file prototype still exists elsewhere in the repo during the migration, but this folder is the new source of truth.

## Windows Install

For a local Windows dev install, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install\windows\install.ps1
```

That will:

- build the daemon and extension
- bundle `plugin/RoSync.plugin.luau`
- copy the plugin into `%LOCALAPPDATA%\Roblox\Plugins\RoSync.plugin.lua`
- create a local CLI shim at `%LOCALAPPDATA%\RoSync\bin\rosync.cmd`

## Build A Testable Plugin File

You can generate a single-file plugin script for Roblox Studio with:

```bash
sh plugin/build.sh
```

That writes:

- `plugin/RoSync.plugin.luau`

To test in Studio:

1. Run `rosync watch` in your test project folder
2. Open Roblox Studio
3. Open the RoSync plugin
4. Connect to `http://127.0.0.1:34872`
