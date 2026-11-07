FROM node:22-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --no-audit --no-fund

FROM node:22-slim AS builder

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production

# Next.js imports Firebase Admin while collecting routes. Use a disposable key
# during the build so production credentials are only needed at runtime.
RUN node -e 'const { generateKeyPairSync } = require("node:crypto"); const { spawnSync } = require("node:child_process"); const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }); const result = spawnSync("npm", ["run", "build"], { stdio: "inherit", env: { ...process.env, FIREBASE_ADMIN_PROJECT_ID: "build-placeholder", FIREBASE_ADMIN_CLIENT_EMAIL: "build-placeholder@example.invalid", FIREBASE_ADMIN_PRIVATE_KEY: privateKey } }); process.exit(result.status ?? 1);'

FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN mkdir .next && chown node:node .next

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000

CMD ["node", "server.js"]
