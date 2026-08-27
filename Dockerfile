FROM ubuntu:22.04

LABEL maintainer="vscode-railway"
LABEL description="VS Code Web IDE with GitHub integration for Railway"

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg git jq unzip wget \
      python3 python3-pip openssh-client \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && curl -fsSL https://code-server.dev/install.sh | sh \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/*

RUN useradd -m -s /bin/bash ide
RUN mkdir -p /workspace /app && chown ide:ide /workspace /app

COPY --chown=ide:ide package.json /app/
WORKDIR /app
USER ide
RUN npm install --omit=dev --cache /tmp/npm-cache && rm -rf /tmp/npm-cache

USER root
COPY --chown=ide:ide server/ /app/server/
COPY --chown=ide:ide public/ /app/public/
COPY --chown=ide:ide start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV WORKSPACE_DIR=/workspace
ENV HOME=/home/ide

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -sf http://localhost:${PORT:-8080}/health || exit 1

USER ide
ENTRYPOINT ["/app/start.sh"]
