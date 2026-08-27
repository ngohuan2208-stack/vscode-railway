#!/bin/bash
set -e

echo "=== VS Code Railway - Initializing ==="

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"

echo "[init] Workspace: ${WORKSPACE_DIR}"
mkdir -p "${WORKSPACE_DIR}/projects"
mkdir -p "${WORKSPACE_DIR}/.config/code-server"
mkdir -p "${WORKSPACE_DIR}/.local/share/code-server"
mkdir -p "${WORKSPACE_DIR}/.cache/code-server"

# Git config
GIT_CONFIG="${WORKSPACE_DIR}/.config/git/config"
if [ ! -f "$GIT_CONFIG" ]; then
  mkdir -p "$(dirname "$GIT_CONFIG")"
  cat > "$GIT_CONFIG" <<EOF
[user]
  name = VS Code User
  email = user@vscode-railway.local
[core]
  autocrlf = input
EOF
  echo "[init] Created git config"
fi

# XDG paths
export HOME="${HOME:-/home/ide}"
export XDG_DATA_HOME="${WORKSPACE_DIR}/.local/share"
export XDG_CONFIG_HOME="${WORKSPACE_DIR}/.config"
export XDG_CACHE_HOME="${WORKSPACE_DIR}/.cache"

echo "[init] Starting..."
exec node /app/server/index.js
