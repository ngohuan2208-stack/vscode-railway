FROM ubuntu:22.04

LABEL maintainer="vscode-railway"
LABEL description="VS Code Web IDE with auth proxy for Railway"

ENV DEBIAN_FRONTEND=noninteractive

# Install base dependencies + code-server + Node.js 18 + dev tools
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl \
      ca-certificates \
      gnupg \
      git \
      jq \
      unzip \
      wget \
      python3 \
      python3-pip \
      openssh-client \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && curl -fsSL https://code-server.dev/install.sh | sh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/*

# Create ide user
RUN useradd -m -s /bin/bash ide

# Create directories
RUN mkdir -p /workspace /app \
    && chown ide:ide /workspace /app

# Copy package.json first (for Docker layer caching)
COPY --chown=ide:ide package.json /app/
WORKDIR /app

# Install npm dependencies as ide user
USER ide
RUN npm install --omit=dev --cache /tmp/npm-cache && rm -rf /tmp/npm-cache

# Copy application files
USER root
COPY --chown=ide:ide server.js /app/
COPY --chown=ide:ide public/ /app/public/
COPY --chown=ide:ide start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Environment defaults
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV WORKSPACE_DIR=/workspace
ENV HOME=/home/ide

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -sf http://localhost:${PORT:-8080}/health || exit 1

USER ide

ENTRYPOINT ["/app/start.sh"]
