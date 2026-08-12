FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CLOUD_EXECUTOR_HEALTH_HOST=127.0.0.1 \
    CLOUD_EXECUTOR_HEALTH_PORT=3001 \
    CLOUD_EXECUTOR_NOVNC_BIND_HOST=127.0.0.1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates xvfb x11vnc novnc websockify x11-utils \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npx playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*

COPY . .

RUN chmod 0755 /app/deploy/cloud-executor-entrypoint.sh \
  && mkdir -p /var/lib/hifly /var/lib/hifly-executor/profile /var/lib/hifly-executor/assets \
      /var/lib/hifly-executor/outputs /var/lib/hifly-executor/evidence \
      /var/lib/hifly-executor/batches /var/lib/hifly-executor/locks \
  && chown -R node:node /app /var/lib/hifly /var/lib/hifly-executor /ms-playwright

USER node

EXPOSE 3001 6080
ENTRYPOINT ["/app/deploy/cloud-executor-entrypoint.sh"]
