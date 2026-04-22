# RoSync Implementation State
> Last updated: 2026-04-22 by Codex

## ✅ Implemented and Working
- Daemon foundation: `rosync init`, `watch`, `status`, `doctor`, `schema update`, `push`, `pull`, `place`, `git`, `update`, and `uninstall` command surfaces exist; daemon boots on loopback and health/status endpoints work, verified by the existing daemon test suite plus local `npm run test`, `npm run build`, and `npm run check`.
- Config/runtime foundation: `rosync.toml`, `.rosyncignore`, loopback host validation, runtime-state persistence, and schema cache loading are implemented and exercised by config/ignore tests plus daemon startup checks.
- Core sync engine foundation: granular disk diffs, subtree rename detection, outbound echo suppression, runtime diagnostics, and conflict records exist in the daemon; verified by `daemon/tests/sync_engine.test.ts`.
- Studio plugin transport foundation: HTTP health checks, WebSocket connect/reconnect, polling fallback, push/pull commands, and a scrollable sync activity feed exist in the Studio plugin source and bundled plugin artifact.
- VS Code live client foundation: the extension connects over WebSocket, shows Explorer and Sync Status sidebars, updates incrementally from daemon events, and tracks connection state in the status bar.
- Installer/update metadata foundation: Windows, macOS, and Linux source installers plus uninstall/update metadata flows exist in the repo and were carried through the audit as implemented foundations.

## 🔴 Known Broken
- First Connect wipes Studio instances: the non-destructive connect fix is now committed and pushed in `plugin/src/main.client.luau` and `plugin/src/sync/Deserializer.luau`, but manual Studio verification is still pending before this can move to ✅ working.
- System services still sync to `src/`: blocked/internal Roblox services like `CoreGui` and `GuiService` are still making it into disk sync paths instead of being hard-blocked, owned by `plugin/src/main.client.luau`, `plugin/src/sync/Listener.luau`, and daemon tree ingestion rules.
- Runtime `Players` children still sync: live player instances under `Players` are being serialized even though they are runtime-only and should be blocked, owned by `plugin/src/sync/Listener.luau` and plugin-side filtering.
- `_RoSyncManaged` attribute is written into Studio instances: RoSync is tagging live instances during apply instead of staying invisible, owned by `plugin/src/sync/Deserializer.luau`.
- Property case duplicates are written to `.instance.json`: duplicate keys such as `Archive` and `archive` can both survive serialization, owned by `plugin/src/sync/Serializer.luau`.
- Camera `CFrame` pushes back on Pull All and causes Studio glitches: camera state is still being round-tripped when it should be guarded or skipped, owned by `plugin/src/sync/Serializer.luau`, `plugin/src/sync/Listener.luau`, and apply filtering.
- Rename in Studio does not reliably update disk: Studio-side rename propagation is still considered broken until end-to-end verification proves disk rename behavior is stable, owned by `plugin/src/sync/Listener.luau`, `plugin/src/main.client.luau`, and `daemon/src/sync/engine.ts`.
- No `RunService` guard during Play mode: the plugin can still watch/apply during simulation when it should back off, owned by `plugin/src/main.client.luau`.
- Connect and Disconnect are separate buttons: the plugin UI still uses separate controls instead of the prompt’s single toggle behavior, owned by `plugin/src/main.client.luau`.
- Start Watch button is redundant: watch activation is still exposed as a separate button even though the prompt wants it removed from the final UI, owned by `plugin/src/main.client.luau`.
- `rosync update` fails on Windows when `npm` is not on PATH: update flow still assumes `npm` resolution that does not hold on some Windows setups, owned by `daemon/src/cli/update.ts` and Windows install/update flow.
- VS Code Explorer has no Roblox class icons: Explorer icon fidelity is still below prompt spec and is treated as broken, owned by `extension/src/explorer/IconMapper.ts` and `extension/src/explorer/ExplorerProvider.ts`.

## 🟡 Partial / Needs Work
- Sync engine: the daemon has real diffing, rename detection, echo suppression, and conflict tracking, but deeper reconciliation heuristics, broader integration coverage, and prompt-grade conflict UX are still missing.
- Roblox Studio plugin: transport, watch, pull/apply, and serializer foundations exist, but end-to-end safety, blocked-service enforcement, Play-mode guards, and verified full-property coverage are still incomplete.
- VS Code extension: Explorer and status panels are live, but the property panel, conflict diff UX, Git history panel, AI agent log/context generation, and polished icon/state behavior are still incomplete at the repo level.
- Docs/tutorial parity: README, architecture, testing, and docs scaffolding exist, but the full tutorial, troubleshooting, schema reference, and broader Docusaurus parity with the prompt are still unfinished.
- Install/release flow: source installers and uninstallers exist, but full fresh-machine verification, extension packaging automation, and release-grade parity still need work.

## ❌ Not Started
- MCP server and AI Agent Mode: high priority — prompt requires tool/context generation and MCP exposure, but repo support is still missing.
- Full conflict-resolution UI in the editor: high priority — prompt calls for a real VS Code diff-driven conflict flow that does not exist yet.
- `.rbxm` / Creator Store packaging flow: medium priority — local bundled plugin exists, but release packaging is not built out.
- Full docs site parity for Section 8: medium priority — documentation structure exists, but large portions of the spec’s written content are still absent.
- Fresh-machine gate verification for Phases 8–10: medium priority — installers and update/uninstall need a full clean-environment proof pass.

## 📋 Current Focus
Run manual Studio verification for the published first-connect wipe fix, then continue down the broken list with blocked-service filtering and runtime `Players` exclusions.
