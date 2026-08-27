#!/bin/bash
# install-extensions.sh - Custom extension installer for sandboxed VSCode
# Add your extensions here or set INSTALL_EXTENSIONS env var (comma-separated)

echo "[extensions] Running custom extension installer..."

# ── Core AI extensions ─────────────────────────────────────────────────────────
# Cline (Claude Dev) - AI coding assistant
code-server --install-extension saoudrizwan.claude-dev --force 2>/dev/null && \
  echo "[extensions] ✓ Cline (Claude Dev)" || \
  echo "[extensions] ✗ Cline failed (may need manual install)"

# ── Productivity extensions ────────────────────────────────────────────────────
code-server --install-extension MS-CEINTL.vscode-language-pack-vi --force 2>/dev/null && \
  echo "[extensions] ✓ Vietnamese Language Pack" || true

code-server --install-extension streetsidesoftware.code-spell-checker --force 2>/dev/null && \
  echo "[extensions] ✓ Code Spell Checker" || true

code-server --install-extension Gruntfuggly.todo-tree --force 2>/dev/null && \
  echo "[extensions] ✓ Todo Tree" || true

code-server --install-extension usernamehw.errorlens --force 2>/dev/null && \
  echo "[extensions] ✓ Error Lens" || true

# ── Language support ───────────────────────────────────────────────────────────
code-server --install-extension rust-lang.rust-analyzer --force 2>/dev/null && \
  echo "[extensions] ✓ Rust Analyzer" || true

code-server --install-extension golang.go --force 2>/dev/null && \
  echo "[extensions] ✓ Go" || true

code-server --install-extension redhat.java --force 2>/dev/null && \
  echo "[extensions] ✓ Java" || true

code-server --install-extension ms-azuretools.vscode-docker --force 2>/dev/null && \
  echo "[extensions] ✓ Docker" || true

# ── Theme ──────────────────────────────────────────────────────────────────────
code-server --install-extension PKief.material-icon-theme --force 2>/dev/null && \
  echo "[extensions] ✓ Material Icon Theme" || true

echo "[extensions] Done. List installed extensions:"
code-server --list-extensions 2>/dev/null || true
