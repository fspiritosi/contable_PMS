#!/bin/sh
# ============================================
# Entrypoint de producción
# Aplica las migraciones de Prisma antes de arrancar el server.
#
# Seguro ante múltiples réplicas (Docker Swarm): `prisma migrate deploy`
# toma un advisory lock en Postgres, por lo que solo una réplica aplica
# las migraciones y el resto espera y continúa sin reaplicar.
#
# Si las migraciones fallan, el contenedor NO arranca (fail-fast) para
# evitar servir contra una BD con el schema desactualizado.
# ============================================
set -e

echo "▶ Aplicando migraciones de base de datos (prisma migrate deploy)..."
node node_modules/prisma/build/index.js migrate deploy
echo "✔ Migraciones aplicadas correctamente."

echo "▶ Iniciando servidor Next.js..."
exec node server.js
