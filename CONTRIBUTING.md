# Contributing

## Principles

- Keep the daemon resilient on malformed input
- Prefer schema-driven behavior over hardcoded Roblox class lists
- Preserve cross-platform path handling
- Treat docs and tests as part of the feature, not cleanup work

## Local Setup

```bash
npm install
npm run build
npm run test
```

## Project Areas

- `daemon/`: CLI, schema, server, sync engine
- `plugin/`: Studio plugin source and build scripts
- `extension/`: VS Code extension
- `docs/`: documentation site content
- `install/`: installer scripts

## Style

- TypeScript uses strict mode
- Luau modules should stay small and composable
- Favor source files that mirror the architecture sections in the prompt
