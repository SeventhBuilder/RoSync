# CLI Overview

The daemon foundation currently includes:

- `rosync init`
- `rosync watch`
- `rosync status`
- `rosync doctor`
- `rosync schema update`
- `rosync push`
- `rosync pull`

While `watch` is running, the daemon also exposes:

- `GET /health`
- `GET /status`
- `GET /schema`
- `GET /api/tree`
- `GET /api/node?path=...`
- `POST /api/node`
- `PATCH /api/node`
- `DELETE /api/node`
