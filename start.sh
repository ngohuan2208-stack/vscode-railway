#!/bin/bash
set -e

echo "=== VS Code Railway - Starting ==="

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
HOME_DIR="${HOME:-/home/ide}"

# ── Environment setup ─────────────────────────────────────────────────────────
export HOME="${HOME_DIR}"

# npm global on persistent Volume (survives restarts)
export NPM_CONFIG_PREFIX="${WORKSPACE_DIR}/.npm-global"
export PATH="${WORKSPACE_DIR}/.npm-global/bin:${HOME_DIR}/.npm-global/bin:${HOME_DIR}/.local/bin:${PATH}"

export XDG_DATA_HOME="${WORKSPACE_DIR}/.local/share"
export XDG_CONFIG_HOME="${WORKSPACE_DIR}/.config"
export XDG_CACHE_HOME="${WORKSPACE_DIR}/.cache"

# ── Persistent npm global on Volume ───────────────────────────────────────────
mkdir -p "${WORKSPACE_DIR}/.npm-global/bin"
mkdir -p "${WORKSPACE_DIR}/.npm-global/lib"
mkdir -p "${HOME_DIR}/.npm-global/bin"
mkdir -p "${HOME_DIR}/.npm-global/lib"

# Configure npm to use workspace volume for global installs
npm config set prefix "${WORKSPACE_DIR}/.npm-global" 2>/dev/null || true

# ── Persistent PATH in bashrc ─────────────────────────────────────────────────
if ! grep -q "npm-global" "${HOME_DIR}/.bashrc" 2>/dev/null; then
  cat >> "${HOME_DIR}/.bashrc" <<'BASHEOF'

# npm global packages on persistent volume
export NPM_CONFIG_PREFIX="/workspace/.npm-global"
export PATH="/workspace/.npm-global/bin:${PATH}"
BASHEOF
fi

# ── Create workspace structure ─────────────────────────────────────────────────
mkdir -p "${WORKSPACE_DIR}/projects"
mkdir -p "${WORKSPACE_DIR}/.config/code-server"
mkdir -p "${WORKSPACE_DIR}/.config/git"
mkdir -p "${WORKSPACE_DIR}/.local/share/code-server"
mkdir -p "${WORKSPACE_DIR}/.cache/code-server"
mkdir -p "${HOME_DIR}/.vscode/extensions"

# ── Git config ─────────────────────────────────────────────────────────────────
GIT_CONFIG="${WORKSPACE_DIR}/.config/git/config"
if [ ! -f "$GIT_CONFIG" ]; then
  cat > "$GIT_CONFIG" <<'EOF'
[user]
  name = VS Code User
  email = user@vscode-railway.local
[core]
  autocrlf = input
[alias]
  co = checkout
  br = branch
  st = status
  lg = log --oneline --graph --all
EOF
  echo "[init] Created git config"
fi

# ── Ensure code-server config exists ───────────────────────────────────────────
CS_CONFIG="${WORKSPACE_DIR}/.config/code-server/config.yaml"
if [ ! -f "$CS_CONFIG" ]; then
  cat > "$CS_CONFIG" <<EOF
bind-addr: 0.0.0.0:8180
auth: none
disable-telemetry: true
disable-update-check: true
cert: false
EOF
  echo "[init] Created code-server config"
fi

# ── Install additional extensions if specified ─────────────────────────────────
if [ -n "${INSTALL_EXTENSIONS:-}" ]; then
  echo "[init] Installing extensions: ${INSTALL_EXTENSIONS}"
  IFS=',' read -ra EXT_ARRAY <<< "$INSTALL_EXTENSIONS"
  for ext in "${EXT_ARRAY[@]}"; do
    ext=$(echo "$ext" | xargs)
    if [ -n "$ext" ]; then
      echo "[init] Installing: $ext"
      code-server --install-extension "$ext" --force 2>/dev/null || \
        echo "[init] WARNING: Failed to install $ext"
    fi
  done
fi

# ── Workspace permissions ──────────────────────────────────────────────────────
if [ -w "${WORKSPACE_DIR}" ]; then
  echo "[init] Workspace writable"
else
  echo "[init] WARNING: Workspace not writable"
fi

# ── Memory info ────────────────────────────────────────────────────────────────
echo "[init] Memory:"
free -h 2>/dev/null || cat /proc/meminfo | head -3 || echo "[init] Cannot read memory"

echo "[init] Starting server..."
exec node /app/server/index.js
