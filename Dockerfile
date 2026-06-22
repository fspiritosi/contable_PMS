# ============================================
# Dockerfile para Next.js + Prisma (standalone)
# ============================================

# --- Stage 1: Dependencies ---
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci

# --- Stage 2: Build ---
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generar Prisma Client
RUN npx prisma generate

# Variables para build:
# - NEXT_PUBLIC_* se leen de .env.production (commitado en el repo)
# - Las server-side solo necesitan valores dummy para que el build pase
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV CLERK_SECRET_KEY="sk_test_dummy"
ENV RESEND_API_KEY="re_dummy"

# Build Next.js (lee .env.production para NEXT_PUBLIC_* vars)
RUN npm run build

# --- Stage 3: Prisma CLI aislado (para `migrate deploy` en el arranque) ---
# El output standalone de Next.js no incluye el CLI de Prisma. En vez de copiar
# el node_modules completo (~1.3 GB) o cherry-pickear deps (fragil: el CLI carga
# @prisma/dev -> valibot, pglite, etc.), instalamos SOLO el CLI en un node_modules
# limpio y lo copiamos entero al runner. Version alineada con package.json.
FROM node:22-alpine AS prisma-cli
RUN apk add --no-cache libc6-compat openssl
WORKDIR /deps
RUN npm init -y >/dev/null 2>&1 && npm install prisma@7.3.0 @prisma/config@7.3.0

# --- Stage 4: Production ---
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Crear usuario no-root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copiar archivos necesarios
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Copiar el CLI de Prisma + engines para poder correr `migrate deploy` en el
# arranque. Va ANTES del standalone para que el node_modules trazado de Next.js
# se mergee encima (mismas versiones) sin pisar las deps del CLI.
COPY --from=prisma-cli /deps/node_modules ./node_modules

# Copiar standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copiar Prisma Client generado
COPY --from=builder /app/src/generated ./src/generated

# Entrypoint: aplica migraciones y luego arranca el server
# Se invoca con `sh` para no depender del bit de ejecución ni de BuildKit (--chmod).
COPY docker-entrypoint.sh ./docker-entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
