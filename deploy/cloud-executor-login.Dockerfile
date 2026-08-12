FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates xvfb x11vnc novnc websockify x11-utils \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npx playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*

COPY . .

RUN chmod 0755 /app/deploy/cloud-executor-login-entrypoint.sh \
  && mkdir -p /var/lib/hifly-executor/profile \
  && chown -R node:node /app /var/lib/hifly-executor /ms-playwright

USER node

EXPOSE 6080
ENTRYPOINT ["/app/deploy/cloud-executor-login-entrypoint.sh"]
