# CLI Overview

The daemon foundation currently includes:

- `rosync init`
- `rosync watch`
- `rosync status`
- `rosync doctor`
- `rosync schema update`
- `rosync push`
- `rosync pull`
- `rosync place list`
- `rosync place add`
- `rosync place switch`
- `rosync git init`
- `rosync git commit`
- `rosync git diff`

While `watch` is running, the daemon also exposes:

- `GET /health`
- `GET /status`
- `GET /schema`
- `GET /api/tree`
- `GET /api/node?path=...`
- `POST /api/node`
- `PATCH /api/node`
- `DELETE /api/node`

The default `rosync watch` terminal also prints high-level sync activity:

- `[Studio] + Add Workspace/Part`
- `[VSCode] ~ Update ServerScriptService/GameManager`
- `[Studio] - Remove Workspace/OldPart`

Action colors are consistent with the Studio plugin feed:

- green for `+ Add`
- yellow for `~ Update` and `~ Rename`
- red for `- Remove`

Use `rosync watch --verbose` when you also want lower-level file watcher noise from `chokidar`.
