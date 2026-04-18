# Testing

## Automated

Current automated coverage focuses on the daemon foundation:

- `rosync.toml` parsing
- `.rosyncignore` parsing
- bootstrap project generation
- project tree discovery
- project tree mutations

Run:

```bash
npm run test
```

For local manual dogfooding, use `examples/dev-project/` as the RoSync project root.

## Manual E2E Checklist

- [ ] `rosync init` creates `rosync.toml`, `src/`, `.rosyncignore`, and `.gitignore`
- [ ] `rosync watch` starts the daemon on the configured host and port
- [ ] `rosync status` reports current instance counts and connection status
- [ ] `rosync doctor` validates config and connectivity assumptions
- [ ] `rosync schema update` refreshes `.rosync/schema.json`
- [ ] `rosync update --force` rebuilds the current source checkout and refreshes installed shims
- [ ] `rosync uninstall --yes --keep-projects` removes installed tooling without touching project source folders
- [ ] `GET /api/tree` returns the current DataModel tree
- [ ] `POST /api/node` creates a new instance directory and metadata file
- [ ] `PATCH /api/node` renames or updates an instance
- [ ] `DELETE /api/node` removes an instance from disk
- [ ] VS Code extension activates and shows RoSync views
- [ ] Roblox Studio plugin builds and opens its dock widget
- [ ] `install/windows/install.ps1` copies the plugin into `%LOCALAPPDATA%\Roblox\Plugins`
- [ ] `install/macos/install.sh` writes a `~/.local/bin/rosync` shim and `~/.rosync-meta/install.json`
- [ ] `install/linux/install.sh` writes a `~/.local/bin/rosync` shim and `~/.rosync-meta/install.json`
- [ ] The installed plugin connects to `http://127.0.0.1:34872`
