# RoSync Implementation State
> Last updated: 2026-04-23 by Codex

## Implemented and Working
- Daemon foundation: `rosync init`, `watch`, `status`, `doctor`, `schema update`, `push`, `pull`, `place`, `git`, `update`, and `uninstall` command surfaces exist; daemon boots on loopback and health/status endpoints work, verified by the existing daemon test suite plus local `npm run test`, `npm run build`, and `npm run check`.
- Config/runtime foundation: `rosync.toml`, `.rosyncignore`, loopback host validation, runtime-state persistence, and schema cache loading are implemented and exercised by config/ignore tests plus daemon startup checks.
- Core sync engine foundation: granular disk diffs, subtree rename detection, outbound echo suppression, runtime diagnostics, and conflict records exist in the daemon; verified by `daemon/tests/sync_engine.test.ts`.
- Studio plugin transport foundation: HTTP health checks, WebSocket connect/reconnect, polling fallback, push/pull commands, and a scrollable sync activity feed exist in the Studio plugin source and bundled plugin artifact.
- Push All is additive-only in current code: the Studio plugin batches syncable instances into `PUSH_BATCH` uploads, the daemon writes those instances to disk without using delete messages or delete paths during Push All, and the daemon routes the resulting refresh as Studio-origin so it does not echo the batch back to Studio.
- WebSocket parse protection is implemented: oversized incoming messages over 10MB are rejected with `MESSAGE_TOO_LARGE`, and JSON parse failures log only a short payload preview before returning `PARSE_ERROR`.
- VS Code live client foundation: the extension connects over WebSocket, shows Explorer and Sync Status sidebars, updates incrementally from daemon events, tracks connection state in the status bar, logs activation failures to the `RoSync` output channel, and uses built-in ThemeIcon-based Roblox class icons.
- Installer/update metadata foundation: Windows, Mac, and Linux source installers plus uninstall/update metadata flows exist in the repo.
- Source installers now install the unpacked RoSync VS Code extension into the local extensions directory and refresh that install on rerun; if a local Cursor profile exists, the installer also copies the same unpacked extension there.
- `rosync init` now scaffolds the current allowed service set in `src/`, including `MaterialService/` and `TextChatService/`.
- Plugin source cleanup: unused plugin UI stubs were removed from `plugin/src/ui/`, the unused `plugin/src/util/SchemaUtil.luau` module was deleted, and the bundled plugin was rebuilt without dead modules.
- Repo cleanup: `AUDIT.md` has been retired in favor of `STATE.md` as the living implementation-status document, and `examples/dev-project/.rosync/runtime.json` is no longer tracked because it is machine-local runtime state.
- Daemon background schema refresh is silent: successful refreshes and version-read failures no longer spam `rosync watch` output.
- `rosync update` is manually verified on Windows: npm resolution uses `node.exe` plus `npm-cli.js`, the updater resets the generated plugin bundle before pull, and the duplicate "Already up to date" message was cleaned up.

## Known Broken
- First Connect wipes Studio instances: the non-destructive connect fix is committed and pushed in `plugin/src/main.client.luau` and `plugin/src/sync/Deserializer.luau`, but manual Studio verification is still pending before this can move to working.

## Partial / Needs Work
- Local plugin distribution mismatch was confirmed on 2026-04-22: the repo bundle had newer fixes, but `C:\Users\Dyu\RoSync\plugin\RoSync.plugin.luau` and `%LOCALAPPDATA%\Roblox\Plugins\RoSync.plugin.lua` were still older copies. Those local copies have now been synchronized with the repo bundle, so any plugin behavior observed before that sync must be re-tested before it is treated as a current code bug.
- Sync engine: the daemon has real diffing, rename detection, echo suppression, and conflict tracking, but deeper reconciliation heuristics, broader integration coverage, and prompt-grade conflict UX are still missing.
- Roblox Studio plugin: transport, watch, pull/apply, and serializer foundations exist, but end-to-end safety, blocked-service enforcement, Play-mode guards, and verified full-property coverage are still incomplete.
- Pull All is additive-only in current code: the plugin fetches the daemon tree directly, applies disk state without deleting unmatched Studio instances, preserves locked services in place, and surfaces progress in the plugin log, but this still needs Studio verification against the installed plugin.
- Sync scope is now enforced by a strict top-level allowlist in code: only `Workspace`, `Players`, `Lighting`, `MaterialService`, `ReplicatedFirst`, `ReplicatedStorage`, `ServerScriptService`, `ServerStorage`, `StarterGui`, `StarterPack`, `StarterPlayer`, `Teams`, `SoundService`, and `TextChatService` are meant to sync; blocked services and their descendants no longer receive listeners at all, but this still needs Studio verification against the updated installed plugin before it can move to working.
- Runtime `Player` instances and their descendants under `Players` are blocked more aggressively in current code, but this still needs Studio verification against real play sessions.
- `_RoSyncManaged` attribute pollution is removed in current deserializer code, but old `.instance.json` files or Studio state may still contain stale data from earlier runs until they are rewritten or cleaned.
- Property-name case deduplication is implemented for new serializer output, property order is forced A-Z in final serialized output, and property capture is broader than before: readable read-only properties are now serialized alongside writable ones, with a fallback for classes that expose no writable descriptors. Older `.instance.json` files can still contain stale duplicate keys such as `Archive` and `archive`, and full datatype/property coverage is still incomplete.
- `Workspace/Camera` is treated as read-only in current code so it can serialize to disk without being pushed back into Studio, but the camera-glitch behavior still needs Studio verification against the updated installed plugin.
- Plugin-side debounce and flood control are tighter in code: scripts use a longer debounce window, camera change events are effectively suppressed, and repeated identical `Source` values are cached to avoid backspace/empty-script flood. This still needs Studio verification against real edit flows.
- Plugin/event log noise is reduced in current code: generic `~ Update` entries are now suppressed for normal instance/property motion and should only remain for script source changes, but this still needs Studio verification against real edit sessions.
- Disk to Studio instance creation now recursively creates nested children during tree apply and `SYNC_INSTANCE` apply, but still needs Studio verification against nested folder trees and real daemon payloads.
- RunService play-mode guarding is implemented in current plugin code for watch/push/pull paths, but still needs Studio verification against the updated installed plugin.
- Rename in Studio to disk propagation is committed and pushed, but still needs end-to-end Studio verification before it can move to working; owned by `plugin/src/sync/Listener.luau`, `plugin/src/main.client.luau`, and `daemon/src/sync/engine.ts`.
- Plugin UI redesign is committed and pushed with a single Connect/Disconnect toggle, no Start Watch button, reduced Studio Output noise, white rename logs, blue move logs for reparent operations, and a status-dot reconnect indicator, but still needs Studio verification before it can move to working; owned by `plugin/src/main.client.luau`.
- Duplicate sibling names under the same parent are still a structural gap: current Studio paths and disk folders are name-based, so two children with the same `Name` in one hierarchy collapse to the same path and one of them disappears from the VS Code view. Fixing this needs a real identity/path migration, not just a logging tweak.
- VS Code extension: Explorer and status panels are live, ThemeIcon-based class icons now exist, but the property panel, conflict diff UX, Git history panel, AI agent log/context generation, and broader polish are still incomplete at the repo level.
- Docs/tutorial parity: README, architecture, testing, and docs scaffolding exist, but the full tutorial, troubleshooting, schema reference, and broader Docusaurus parity with the prompt are still unfinished.
- Install/release flow: source installers and uninstallers exist, but full fresh-machine verification, extension packaging automation, and release-grade parity still need work.

## Not Started
- MCP server and AI Agent Mode: high priority - prompt requires tool/context generation and MCP exposure, but repo support is still missing.
- Full conflict-resolution UI in the editor: high priority - prompt calls for a real VS Code diff-driven conflict flow that does not exist yet.
- Full docs site parity for Section 8: medium priority - documentation structure exists, but large portions of the spec's written content are still absent.
- Fresh-machine gate verification for Phases 8-10: medium priority - installers and update/uninstall need a full clean-environment proof pass.

## Current Focus
Re-test the updated installed Studio plugin after the latest plugin fixes, focusing first on first-connect safety, strict service filtering, runtime-player blocking, recursive disk-to-Studio creation, reduced update-log noise, camera behavior, rename/move propagation, and the duplicate-name path-collision problem.
