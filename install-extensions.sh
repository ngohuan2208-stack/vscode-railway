#!/bin/bash
# install-extensions.sh - No longer used in Docker build
# Extensions are pre-installed in Dockerfile or installed via INSTALL_EXTENSIONS env var
echo "[extensions] Extensions are managed via Dockerfile and INSTALL_EXTENSIONS env var."
echo "[extensions] To install more, use: code-server --install-extension <ext-id>"
