# Architecture

## Summary

RoSync is being rebuilt as a loopback-first, multi-part toolchain:

1. A daemon CLI that owns config, schema cache, sync state, HTTP, and WebSocket transport
2. A Roblox Studio plugin that observes and applies DataModel changes
3. An editor extension foundation that renders RoSync views and talks to the daemon
4. Docs, installers, and tests treated as first-class deliverables

## Stack Choice

The prompt allows Rust or Node.js for the daemon. This repository is starting with Node.js + TypeScript because:

- `node` and `npm` are installed in the current environment
- `cargo` and `rustc` are not installed
- TypeScript keeps the CLI, current VS Code integration, and shared protocol models aligned

## Daemon Shape

The new daemon is organized under `daemon/src/`:

- `cli/`: command entry points
- `config/`: `rosync.toml` loading and `.rosyncignore` parsing
- `schema/`: schema cache, bundled fallback, and updater
- `server/`: HTTP and WebSocket runtime
- `sync/`: state tracking, status summaries, debounce helpers
- `serializer/`: `.instance.json` and property helpers

## Runtime Model

- Default host: `127.0.0.1`
- Default port: `34872`
- Project config: `rosync.toml`
- Ignore file: `.rosyncignore`
- Cache directory: `.rosync/`
- Schema cache: `.rosync/schema.json`
- Runtime state: `.rosync/runtime.json`

The config loader rejects any non-loopback host so the daemon cannot be bound to `0.0.0.0` by accident.

## Install Lifecycle

Source installs are tracked with platform-local metadata:

- Windows: `%LOCALAPPDATA%\RoSync\meta`
- Mac/Linux: `~/.rosync-meta`

That metadata records the linked source checkout, CLI launcher paths, plugin install path, and uninstall script path. `rosync update` uses it to rebuild in place and refresh shims safely with `.bak` backups, while `rosync uninstall` delegates to the platform uninstall script and leaves linked development checkouts untouched.

## Dev Fixture

The repository root no longer doubles as a live RoSync project. Local dogfooding lives in `examples/dev-project/`, which keeps the tool source tree separate from sample synced-instance data.

## Incremental Delivery

This rebuild starts with the daemon foundation and scaffolding for the plugin, extension, docs, and installers. More advanced sync behavior, conflict resolution, MCP tooling, and richer UIs will be layered onto this structure rather than onto the older prototype layout.
