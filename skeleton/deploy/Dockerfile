# Multi-stage Bun build (ADR-0005 recipe)
# Usage: docker build -f deploy/Dockerfile -t api:latest .
#        docker run -e NODE_ENV=production -e DATABASE_URL=... api:latest

FROM oven/bun:latest AS builder

WORKDIR /build
COPY . .

RUN bun install --frozen-lockfile
RUN bun run build

# Runtime stage: minimal Bun image
FROM oven/bun:latest

WORKDIR /app

# Copy only production artifacts and package.json
COPY --from=builder /build/package.json /build/bun.lockb ./
COPY --from=builder /build/apps/api/dist ./apps/api/dist
COPY --from=builder /build/packages ./packages

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD bun run -e "import('http').then(m => m.createServer((q, r) => { r.writeHead(200); r.end(); }).listen(3000))" || exit 1

# Start the API server
CMD ["bun", "run", "apps/api/dist/main.js"]

EXPOSE 3000
