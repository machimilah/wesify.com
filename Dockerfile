# BO, as one image.
#
# Two stages, because the frontend build needs the whole toolchain — vite, typescript, every dev
# dependency — and the running server needs none of it. Shipping one stage would mean shipping a
# compiler and ~200MB of build tooling to production, and giving anything that got into the container
# a build system to work with.
#
# Build:  docker build -t bo .
# Run:    docker run -p 8787:8787 -e DATABASE_URL=... -v bo-data:/data bo

# ---- stage 1: build the frontend -----------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

# Manifests first, on their own layer. Docker reuses this layer whenever they have not changed, so
# editing application code does not reinstall the dependency tree.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build


# ---- stage 2: the server -------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Nothing outside the container can reach a port bound to loopback, so the container overrides the
# host BO uses on a laptop. `PORT` is what most platforms inject; 8787 is the fallback.
ENV BO_HOST=0.0.0.0
ENV PORT=8787
# Everything BO still keeps on disk — the generated Command Center, connection credentials, industry
# knowledge — lives under one path, so a single volume covers all of it. Records live in Postgres.
ENV BO_GENERATED_ROOT=/data

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY --from=build /app/dist ./dist

# One file from the frontend tree, because one list is the whole point of it.
#
# `src/data/platformPatternIds.json` is the vocabulary of process, KPI and pattern ids that the
# browser offers and the server validates against. A copy kept under `server/` would be a second
# hand-maintained list, and the drift would surface as the server rejecting a pattern the interface
# had just shown somebody. So the file stays shared and the runtime image carries it.
#
# `structure.test.mjs` fails if any other server import reaches outside what this stage copies: the
# first time one did, nothing caught it until a container died in CI.
COPY src/data/platformPatternIds.json ./src/data/platformPatternIds.json

# The image runs as a non-root user. `node` already exists in this base image; /data is created and
# handed over before dropping to it, because a container that cannot write its own data directory
# fails at the first build rather than at start.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8787

# The server already answers /api/health without touching the database, so an unhealthy container is
# one that cannot serve at all rather than one whose Postgres is briefly slow.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No npm in front of node: npm forwards neither SIGTERM nor the exit code faithfully, and BO closes
# its server on SIGTERM so in-flight requests finish before the process goes.
CMD ["node", "server/index.mjs"]
