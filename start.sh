#!/bin/bash
set -e

echo "=== VS Code Railway - Initializing ==="

# ─── Environment ──────────────────────────────────────────────────────────────
WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"

# ─── Create workspace structure ───────────────────────────────────────────────
echo "[init] Setting up workspace at ${WORKSPACE_DIR}"
mkdir -p "${WORKSPACE_DIR}/projects"
mkdir -p "${WORKSPACE_DIR}/.config/code-server"
mkdir -p "${WORKSPACE_DIR}/.local/share/code-server"
mkdir -p "${WORKSPACE_DIR}/.cache/code-server"

# ─── Setup Git config if not exists ───────────────────────────────────────────
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
  echo "[init] Created default git config"
fi

# ─── Ensure workspace is writable ────────────────────────────────────────────
if [ -w "${WORKSPACE_DIR}" ]; then
  echo "[init] Workspace is writable"
else
  echo "[init] WARNING: Workspace is not writable. Data may not persist."
fi

# ─── Export paths for code-server ─────────────────────────────────────────────
export HOME="${HOME:-/home/ide}"
export XDG_DATA_HOME="${WORKSPACE_DIR}/.local/share"
export XDG_CONFIG_HOME="${WORKSPACE_DIR}/.config"
export XDG_CACHE_HOME="${WORKSPACE_DIR}/.cache"

echo "[init] HOME=${HOME}"
echo "[init] Initialization complete"

# ─── Start the Node.js auth proxy (main process) ─────────────────────────────
echo "[init] Starting auth proxy server..."
exec node /app/server.js
