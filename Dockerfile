FROM node:22-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /var/lib/hifly /var/backups/hifly \
  && chown -R node:node /app /var/lib/hifly /var/backups/hifly

USER node

EXPOSE 3000
CMD ["npm", "run", "start:production"]
