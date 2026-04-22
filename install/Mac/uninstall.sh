#!/usr/bin/env sh
set -eu

YES=0
KEEP_PROJECTS=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --yes)
      YES=1
      ;;
    --keep-projects)
      KEEP_PROJECTS=1
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

PLUGIN_INSTALL_PATH="$HOME/Library/Application Support/Roblox/Plugins/RoSync.plugin.lua"
SHIM_PATH="$HOME/.local/bin/rosync"
META_DIR="$HOME/.rosync-meta"
INSTALL_METADATA_FILE="$META_DIR/install.json"
INSTALL_PATH_FILE="$META_DIR/install-path"
EXTENSION_ID="rosync.rosync-extension"
PATH_MARKER_BEGIN="# >>> RoSync CLI >>>"
PATH_MARKER_END="# <<< RoSync CLI <<<"

confirm_uninstall() {
  if [ "$YES" -eq 1 ]; then
    return
  fi

  printf "Remove RoSync tooling from this system? [y/N] "
  read -r ANSWER || ANSWER=""
  case "$ANSWER" in
    y|Y|yes|YES)
      ;;
    *)
      echo "Cancelled."
      exit 0
      ;;
  esac
}

stop_daemon() {
  if command -v lsof >/dev/null 2>&1; then
    PIDS=$(lsof -ti tcp:34872 -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
      for PID in $PIDS; do
        kill "$PID" 2>/dev/null || true
      done
    fi
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k 34872/tcp 2>/dev/null || true
  fi
}

load_metadata_field() {
  FIELD_NAME="$1"
  node -e 'const fs = require("node:fs"); const [file, field] = process.argv.slice(1); try { const data = JSON.parse(fs.readFileSync(file, "utf8")); const value = data[field]; process.stdout.write(typeof value === "string" ? value : ""); } catch {}' "$INSTALL_METADATA_FILE" "$FIELD_NAME"
}

confirm_uninstall

SOURCE_MODE=""
SOURCE_DIR=""
if [ -f "$INSTALL_METADATA_FILE" ]; then
  SOURCE_MODE=$(load_metadata_field sourceMode)
  SOURCE_DIR=$(load_metadata_field sourceDir)
fi

echo "==> Stopping RoSync daemon processes on localhost:34872"
stop_daemon

echo "==> Removing CLI shim"
rm -f "$SHIM_PATH"

echo "==> Removing Roblox Studio plugin"
rm -f "$PLUGIN_INSTALL_PATH"

echo "==> Removing install metadata"
rm -f "$INSTALL_METADATA_FILE" "$INSTALL_PATH_FILE"
rmdir "$META_DIR" 2>/dev/null || true

remove_shell_profile_path() {
  PROFILE_PATH="$1"
  if [ ! -f "$PROFILE_PATH" ]; then
    return
  fi

  node - "$PROFILE_PATH" "$PATH_MARKER_BEGIN" "$PATH_MARKER_END" <<'EOF'
const fs = require("node:fs");
const [profilePath, begin, end] = process.argv.slice(2);
const text = fs.readFileSync(profilePath, "utf8");
const escapedBegin = begin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapedEnd = end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = new RegExp(`\\n?${escapedBegin}[\\s\\S]*?${escapedEnd}\\n?`, "g");
const next = text.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n");
if (next !== text) {
  fs.writeFileSync(profilePath, next, "utf8");
}
EOF
}

remove_shell_profile_path "$HOME/.bashrc"
remove_shell_profile_path "$HOME/.zshrc"

echo "==> Removing editor extension (best effort)"
if command -v code >/dev/null 2>&1; then
  code --uninstall-extension "$EXTENSION_ID" >/dev/null 2>&1 || true
fi

if [ "$SOURCE_MODE" = "managed" ] && [ -n "$SOURCE_DIR" ] && [ -d "$SOURCE_DIR" ]; then
  echo "==> Removing managed source checkout"
  rm -rf "$SOURCE_DIR"
else
  echo "Leaving linked source checkout in place."
fi

if [ "$KEEP_PROJECTS" -eq 0 ]; then
  echo "Project-local .rosync cache cleanup is not automated yet; leaving project folders untouched."
fi

echo
echo "RoSync has been removed from this machine."
echo "Project source folders remain untouched."
