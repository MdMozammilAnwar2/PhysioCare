# PhysioCare production images, built from the repository root:
#   docker compose -f deploy/docker-compose.prod.yml build
# Targets: `api` (Node API + built website for page previews) and `web` (Caddy serving website and console).

# ---------- 1. install (only the API and web workspaces; the mobile apps are built with EAS) ----------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/tokens/package.json packages/tokens/
COPY apps/api/package.json apps/api/
COPY apps/web-site/package.json apps/web-site/
COPY apps/web-admin/package.json apps/web-admin/
COPY apps/mobile-patient/package.json apps/mobile-patient/
COPY apps/mobile-therapist/package.json apps/mobile-therapist/
COPY apps/mobile-admin/package.json apps/mobile-admin/
RUN npm ci --ignore-scripts --no-audit --no-fund -w apps/api -w apps/web-site -w apps/web-admin --include-workspace-root

# ---------- 2. build the website and console ----------
FROM deps AS web-build
COPY packages packages
COPY apps/web-site apps/web-site
COPY apps/web-admin apps/web-admin
RUN npm run build -w @physioconnect/web-site && npm run build -w @physioconnect/web-admin

# ---------- 3. API ----------
FROM node:24-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared packages/shared
COPY packages/tokens packages/tokens
COPY apps/api/package.json apps/api/
COPY apps/web-site/package.json apps/web-site/
COPY apps/web-admin/package.json apps/web-admin/
COPY apps/mobile-patient/package.json apps/mobile-patient/
COPY apps/mobile-therapist/package.json apps/mobile-therapist/
COPY apps/mobile-admin/package.json apps/mobile-admin/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w apps/api --include-workspace-root=false && npm cache clean --force
COPY apps/api apps/api
COPY --from=web-build /app/apps/web-site/dist /app/web-site-dist
RUN rm -rf apps/api/test apps/api/.env apps/api/.env.* apps/api/storage apps/api/storage-test \
  && mkdir -p /data/storage && chown -R node:node /data
ENV WEB_SITE_DIST=/app/web-site-dist STORAGE_DIR=/data/storage PORT=4000
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
# Apply any new database migrations, then start. Migrations are safe to run on every start.
CMD ["sh", "-c", "node scripts/migrate.js up && node src/server.js"]

# ---------- 4. web: Caddy (automatic HTTPS) with the built website and console ----------
FROM caddy:2.8-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web-site/dist /srv/site
COPY --from=web-build /app/apps/web-admin/dist /srv/admin
