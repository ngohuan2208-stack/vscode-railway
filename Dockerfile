FROM ubuntu:22.04

LABEL maintainer="vscode-railway"
LABEL description="Sandboxed VS Code Web IDE with AI extensions"

ENV DEBIAN_FRONTEND=noninteractive
ENV SHELL=/bin/bash

# ── System dependencies ───────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg git jq unzip wget \
      python3 python3-pip python3-venv openssh-client \
      build-essential pkg-config libx11-dev libxkbfile-dev \
      sudo tmux htop tree ripgrep fd-find \
      libc6 libstdc++6 libnss3 libatk-bridge2.0-0 \
      libgtk-3-0 libgbm1 libasound2 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/*

# ── code-server ───────────────────────────────────────────────────────────────
RUN curl -fsSL https://code-server.dev/install.sh | sh

# ── Create sandbox user ───────────────────────────────────────────────────────
RUN useradd -m -s /bin/bash -G sudo ide \
    && echo 'ide ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers \
    && mkdir -p /workspace /home/ide/.vscode/extensions /home/ide/.config/code-server \
    && chown -R ide:ide /workspace /home/ide

# ── Install extensions as ide user ────────────────────────────────────────────
USER ide
WORKDIR /home/ide

# Install extensions in parallel
RUN code-server --install-extension saoudrizwan.claude-dev --force 2>/dev/null || true
RUN code-server --install-extension Codota-tabnine-vscode --force 2>/dev/null || true
RUN code-server --install-extension GitHub.copilot --force 2>/dev/null || true
RUN code-server --install-extension eamodio.gitlens --force 2>/dev/null || true
RUN code-server --install-extension ms-python.python --force 2>/dev/null || true
RUN code-server --install-extension dbaeumer.vscode-eslint --force 2>/dev/null || true
RUN code-server --install-extension esbenp.prettier-vscode --force 2>/dev/null || true
RUN code-server --install-extension bradlc.vscode-tailwindcss --force 2>/dev/null || true
RUN code-server --install-extension formulahendry.auto-rename-tag --force 2>/dev/null || true
RUN code-server --install-extension christian-kohler.path-intellisense --force 2>/dev/null || true

# ── Configure code-server ─────────────────────────────────────────────────────
RUN mkdir -p /home/ide/.config/code-server \
    && cat > /home/ide/.config/code-server/config.yaml <<'EOF'
bind-addr: 0.0.0.0:8180
auth: none
disable-telemetry: true
disable-update-check: true
cert: false
EOF

# ── VS Code settings for sandbox ──────────────────────────────────────────────
RUN mkdir -p /home/ide/.local/share/code-server/User \
    && cat > /home/ide/.local/share/code-server/User/settings.json <<'SETTINGS'
{
  "workbench.colorTheme": "Default Dark+",
  "editor.fontSize": 14,
  "editor.tabSize": 2,
  "editor.wordWrap": "on",
  "editor.minimap.enabled": true,
  "terminal.integrated.fontSize": 13,
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000,
  "extensions.autoUpdate": false,
  "extensions.showRecommendationsOnlyOnDemand": false,
  "git.autofetch": true,
  "git.confirmSync": false,
  "workbench.startupEditor": "none",
  "security.workspace.trust.untrustedFiles": "open",
  "security.workspace.trust.enabled": false,
  "terminal.integrated.defaultProfile.linux": "bash"
}
SETTINGS

# ── Keybindings ────────────────────────────────────────────────────────────────
RUN cat > /home/ide/.local/share/code-server/User/keybindings.json <<'KEYS'
[
  { "key": "ctrl+shift+p", "command": "workbench.action.showCommands" },
  { "key": "ctrl+`", "command": "workbench.action.terminal.toggleTerminal" },
  { "key": "ctrl+shift+`", "command": "workbench.action.terminal.new" },
  { "key": "ctrl+b", "command": "workbench.action.toggleSidebarVisibility" }
]
KEYS

# ── Copy app files ────────────────────────────────────────────────────────────
USER root
COPY --chown=ide:ide package.json /app/
WORKDIR /app
USER ide
RUN npm install --omit=dev --cache /tmp/npm-cache && rm -rf /tmp/npm-cache

USER root
COPY --chown=ide:ide server/ /app/server/
COPY --chown=ide:ide public/ /app/public/
COPY --chown=ide:ide start.sh /app/start.sh
COPY --chown=ide:ide install-extensions.sh /app/install-extensions.sh
RUN chmod +x /app/start.sh /app/install-extensions.sh

# ── Sandbox directories ────────────────────────────────────────────────────────
RUN mkdir -p /workspace/projects /workspace/.config /workspace/.local/share \
    && chown -R ide:ide /workspace /app

# ── Environment ───────────────────────────────────────────────────────────────
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV WORKSPACE_DIR=/workspace
ENV HOME=/home/ide
ENV PATH="/home/ide/.local/bin:${PATH}"

# ── Healthcheck ────────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -sf http://localhost:${PORT:-8080}/health || exit 1

USER ide
ENTRYPOINT ["/app/start.sh"]
