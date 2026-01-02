# FlareWatch Proxy - Docker Image
# Multi-stage build: Chainguard builder + Node 24 Alpine runtime (non-root)

# =============================================================================
# Stage 1: Build and compile TypeScript
# =============================================================================
FROM cgr.dev/chainguard/node:latest-dev@sha256:5e1ebdfc0c312d785515f403e309a8f6edf735eee96dd0d156328f5867c48742 AS builder

WORKDIR /app

# Copy package files for dependency caching
COPY --chown=65532:65532 package.json pnpm-lock.yaml ./

# Install all dependencies (including devDeps for build)
RUN pnpm install --frozen-lockfile

# Copy source files
COPY --chown=65532:65532 . .

# Type check
RUN pnpm compile

# Build to JavaScript
RUN pnpm build

# =============================================================================
# Stage 2: Runtime (Node 24 LTS)
# =============================================================================
FROM node:24-alpine@sha256:c921b97d4b74f51744057454b306b418cf693865e73b8100559189605f6955b8 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Remove npm/yarn/corepack (proxy doesn't need them).
RUN rm -rf \
    /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/lib/node_modules/corepack \
    /usr/local/bin/corepack \
    /opt/yarn* \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg

# Copy compiled JavaScript (single bundled file)
COPY --chown=node:node --from=builder /app/dist/index.mjs ./dist/index.mjs

EXPOSE 3000

USER node

CMD ["node", "dist/index.mjs"]
