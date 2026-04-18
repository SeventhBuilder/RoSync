#!/usr/bin/env sh
set -eu

node "$(dirname "$0")/tools/bundle.mjs"
echo "Built plugin/RoSync.plugin.luau"
