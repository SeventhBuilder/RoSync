# Quick Start

1. Install dependencies for this repo.
2. Build the daemon with `npm run build`.
3. Run `npm run dev:daemon -- init` inside a Roblox project folder.
4. Start the daemon with `npm run dev:daemon -- watch`.
5. In Roblox Studio, open the RoSync plugin and connect to `http://127.0.0.1:34872`.
6. Use the plugin's scrollable **Sync Activity** feed to watch source-labeled events like `[Studio] + Add ...` and `[VSCode] ~ Update ...`.
7. Keep the daemon terminal open to see the same high-level mutation stream with colored action tokens.
