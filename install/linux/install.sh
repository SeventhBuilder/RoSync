#!/usr/bin/env sh
set -eu

SKIP_NPM_INSTALL=0
SKIP_BUILD=0
PLUGIN_ONLY=0
NO_PATH=0
SKIP_VSCODE_EXTENSION=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-npm-install)
      SKIP_NPM_INSTALL=1
      ;;
    --skip-build)
      SKIP_BUILD=1
      ;;
    --plugin-only)
      PLUGIN_ONLY=1
      ;;
    --no-path)
      NO_PATH=1
      ;;
    --skip-vscode-extension)
      SKIP_VSCODE_EXTENSION=1
      ;;
    --uninstall)
      exec sh "$(dirname "$0")/uninstall.sh"
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

REPO_ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
PLUGIN_SOURCE="$REPO_ROOT/plugin/RoSync.plugin.luau"
PLUGIN_INSTALL_DIR="$HOME/.local/share/Roblox/Plugins"
PLUGIN_INSTALL_PATH="$PLUGIN_INSTALL_DIR/RoSync.plugin.lua"
SHIM_DIR="$HOME/.local/bin"
SHIM_PATH="$SHIM_DIR/rosync"
META_DIR="$HOME/.rosync-meta"
INSTALL_PATH_FILE="$META_DIR/install-path"
INSTALL_METADATA_FILE="$META_DIR/install.json"
DAEMON_ENTRY="$REPO_ROOT/daemon/dist/main.js"
INSTALL_SCRIPT="$REPO_ROOT/install/linux/install.sh"
UNINSTALL_SCRIPT="$REPO_ROOT/install/linux/uninstall.sh"

write_step() {
  echo "==> $1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command '$1' was not found on PATH." >&2
    exit 1
  fi
}

install_plugin() {
  if [ ! -f "$PLUGIN_SOURCE" ]; then
    echo "Bundled plugin was not found at $PLUGIN_SOURCE. Run the build step first." >&2
    exit 1
  fi

  write_step "Installing Roblox Studio plugin"
  mkdir -p "$PLUGIN_INSTALL_DIR"
  cp "$PLUGIN_SOURCE" "$PLUGIN_INSTALL_PATH"
}

install_shim() {
  if [ ! -f "$DAEMON_ENTRY" ]; then
    echo "Built daemon entrypoint was not found at $DAEMON_ENTRY. Run the build step first." >&2
    exit 1
  fi

  write_step "Writing local RoSync CLI shim"
  mkdir -p "$SHIM_DIR"
  cat >"$SHIM_PATH" <<EOF
#!/usr/bin/env sh
exec node "$DAEMON_ENTRY" "\$@"
EOF
  chmod +x "$SHIM_PATH"
}

write_metadata() {
  mkdir -p "$META_DIR"
  node - "$META_DIR" "$REPO_ROOT" "$DAEMON_ENTRY" "$PLUGIN_SOURCE" "$PLUGIN_INSTALL_PATH" "$INSTALL_SCRIPT" "$UNINSTALL_SCRIPT" "$SHIM_PATH" <<'EOF'
const fs = require("node:fs");
const path = require("node:path");

const [metaDir, sourceDir, cliEntry, pluginSource, pluginInstallPath, installScript, uninstallScript, ...cliLaunchers] =
  process.argv.slice(2);

const metadataPath = path.join(metaDir, "install.json");
let installedAt = new Date().toISOString();
try {
  const existing = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  if (typeof existing.installedAt === "string" && existing.installedAt) {
    installedAt = existing.installedAt;
  }
} catch {}

const now = new Date().toISOString();
const payload = {
  version: 1,
  installedAt,
  updatedAt: now,
  platform: process.platform,
  sourceDir,
  sourceMode: "linked",
  metaDir,
  cliEntry,
  cliLaunchers,
  pluginSource,
  pluginInstallPath,
  installScript,
  uninstallScript,
  extensionId: "rosync.rosync-vscode",
};

fs.writeFileSync(path.join(metaDir, "install-path"), `${sourceDir}\n`, "utf8");
fs.writeFileSync(metadataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
EOF
}

install_vscode_extension() {
  if [ "$SKIP_VSCODE_EXTENSION" -eq 1 ]; then
    return
  fi

  if command -v code >/dev/null 2>&1; then
    echo "VS Code extension packaging is not automated in the source installer yet; skipping automatic extension install."
  fi
}

print_path_hint() {
  if [ "$NO_PATH" -eq 1 ]; then
    return
  fi

  case ":$PATH:" in
    *":$SHIM_DIR:"*)
      ;;
    *)
      echo "Add $SHIM_DIR to your PATH if \`rosync\` is not found in a new terminal session."
      ;;
  esac
}

require_command node
if [ "$PLUGIN_ONLY" -eq 0 ]; then
  require_command npm
fi

if [ "$PLUGIN_ONLY" -eq 0 ] && [ "$SKIP_NPM_INSTALL" -eq 0 ]; then
  write_step "Installing npm dependencies"
  (cd "$REPO_ROOT" && npm install)
fi

if [ "$SKIP_BUILD" -eq 0 ]; then
  if [ "$PLUGIN_ONLY" -eq 1 ]; then
    write_step "Bundling Studio plugin"
    (cd "$REPO_ROOT" && node plugin/tools/bundle.mjs)
  else
    write_step "Building daemon and extension"
    (cd "$REPO_ROOT" && npm run build)
    write_step "Bundling Studio plugin"
    (cd "$REPO_ROOT" && node plugin/tools/bundle.mjs)
  fi
fi

install_plugin

if [ "$PLUGIN_ONLY" -eq 0 ]; then
  install_shim
  write_metadata
  install_vscode_extension
  print_path_hint
fi

echo
echo "Installed:"
echo "  Plugin: $PLUGIN_INSTALL_PATH"
if [ "$PLUGIN_ONLY" -eq 0 ]; then
  echo "  CLI shim: $SHIM_PATH"
  echo "  Metadata: $INSTALL_METADATA_FILE"
fi

echo
echo "Next steps:"
echo "  1. Open your RoSync project folder in a new terminal session."
if [ "$PLUGIN_ONLY" -eq 0 ]; then
  echo "  2. Start the daemon with: rosync watch"
else
  echo "  2. Start the daemon with: node $DAEMON_ENTRY watch"
fi
echo "  3. In Roblox Studio, open the RoSync plugin."
echo "  4. The daemon will bind to http://127.0.0.1:34872 by default."
