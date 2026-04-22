#!/usr/bin/env sh
set -eu

SKIP_NPM_INSTALL=0
SKIP_BUILD=0
PLUGIN_ONLY=0
NO_PATH=0
SKIP_EDITOR_EXTENSION=0
SKIP_VSCODE_EXTENSION=0

PATH_MARKER_BEGIN="# >>> RoSync CLI >>>"
PATH_MARKER_END="# <<< RoSync CLI <<<"
PATH_EXPORT='export PATH="$HOME/.local/bin:$PATH"'

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
    --skip-editor-extension)
      SKIP_EDITOR_EXTENSION=1
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
EXTENSION_SOURCE_DIR="$REPO_ROOT/extension"
EXTENSION_MANIFEST="$EXTENSION_SOURCE_DIR/package.json"
EXTENSION_ENTRY="$EXTENSION_SOURCE_DIR/dist/extension.js"
EXTENSION_INSTALL_PATHS=""

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
  extensionId: "rosync.rosync-extension",
};

fs.writeFileSync(path.join(metaDir, "install-path"), `${sourceDir}\n`, "utf8");
fs.writeFileSync(metadataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
EOF
}

append_extension_install_path() {
  if [ -z "$EXTENSION_INSTALL_PATHS" ]; then
    EXTENSION_INSTALL_PATHS="$1"
  else
    EXTENSION_INSTALL_PATHS="$EXTENSION_INSTALL_PATHS
$1"
  fi
}

install_extension_root() {
  EXTENSION_ROOT="$1"
  mkdir -p "$EXTENSION_ROOT"
  find "$EXTENSION_ROOT" -mindepth 1 -maxdepth 1 -type d -name "$RESOLVED_EXTENSION_ID-*" -exec rm -rf {} +
  DESTINATION="$EXTENSION_ROOT/$TARGET_FOLDER_NAME"
  rm -rf "$DESTINATION"
  cp -R "$EXTENSION_SOURCE_DIR" "$DESTINATION"
  append_extension_install_path "$DESTINATION"
}

install_editor_extension() {
  if [ "$SKIP_EDITOR_EXTENSION" -eq 1 ] || [ "$SKIP_VSCODE_EXTENSION" -eq 1 ]; then
    return
  fi

  if [ ! -f "$EXTENSION_ENTRY" ]; then
    echo "Built extension entrypoint was not found at $EXTENSION_ENTRY. Run the build step first." >&2
    exit 1
  fi

  if [ ! -f "$EXTENSION_MANIFEST" ]; then
    echo "Extension manifest was not found at $EXTENSION_MANIFEST." >&2
    exit 1
  fi

  EXTENSION_PUBLISHER=$(node -e 'const fs = require("node:fs"); const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(typeof manifest.publisher === "string" ? manifest.publisher : "");' "$EXTENSION_MANIFEST")
  EXTENSION_NAME=$(node -e 'const fs = require("node:fs"); const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(typeof manifest.name === "string" ? manifest.name : "");' "$EXTENSION_MANIFEST")
  EXTENSION_VERSION=$(node -e 'const fs = require("node:fs"); const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(typeof manifest.version === "string" ? manifest.version : "");' "$EXTENSION_MANIFEST")

  if [ -z "$EXTENSION_PUBLISHER" ] || [ -z "$EXTENSION_NAME" ] || [ -z "$EXTENSION_VERSION" ]; then
    echo "Extension manifest is missing publisher, name, or version." >&2
    exit 1
  fi

  RESOLVED_EXTENSION_ID="$EXTENSION_PUBLISHER.$EXTENSION_NAME"
  TARGET_FOLDER_NAME="$RESOLVED_EXTENSION_ID-$EXTENSION_VERSION"
  EXTENSION_INSTALL_PATHS=""

  write_step "Installing editor extension"
  install_extension_root "$HOME/.vscode/extensions"
  if [ -d "$HOME/.cursor" ]; then
    install_extension_root "$HOME/.cursor/extensions"
  fi
}

ensure_shell_profile_path() {
  PROFILE_PATH="$1"
  if [ -f "$PROFILE_PATH" ] && grep -F "$PATH_MARKER_BEGIN" "$PROFILE_PATH" >/dev/null 2>&1; then
    return
  fi

  {
    printf "\n%s\n" "$PATH_MARKER_BEGIN"
    printf "%s\n" "$PATH_EXPORT"
    printf "%s\n" "$PATH_MARKER_END"
  } >>"$PROFILE_PATH"
}

configure_shell_profiles() {
  if [ "$NO_PATH" -eq 1 ]; then
    return
  fi

  ensure_shell_profile_path "$HOME/.bashrc"
  ensure_shell_profile_path "$HOME/.zshrc"
}

print_path_hint() {
  if [ "$NO_PATH" -eq 1 ]; then
    return
  fi

  case ":$PATH:" in
    *":$SHIM_DIR:"*)
      ;;
    *)
      echo "Added PATH setup for bash/zsh profiles. Open a new shell if \`rosync\` is not found immediately."
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
    write_step "Building daemon and editor extension"
    (cd "$REPO_ROOT" && npm run build)
    write_step "Bundling Studio plugin"
    (cd "$REPO_ROOT" && node plugin/tools/bundle.mjs)
  fi
fi

install_plugin

if [ "$PLUGIN_ONLY" -eq 0 ]; then
  install_shim
  write_metadata
  install_editor_extension
  configure_shell_profiles
  print_path_hint
fi

echo
echo "Installed:"
echo "  Plugin: $PLUGIN_INSTALL_PATH"
if [ "$PLUGIN_ONLY" -eq 0 ]; then
  echo "  CLI shim: $SHIM_PATH"
  echo "  Metadata: $INSTALL_METADATA_FILE"
  if [ -n "$EXTENSION_INSTALL_PATHS" ]; then
    printf '%s\n' "$EXTENSION_INSTALL_PATHS" | while IFS= read -r EXTENSION_PATH; do
      [ -n "$EXTENSION_PATH" ] && echo "  Editor extension: $EXTENSION_PATH"
    done
  fi
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
