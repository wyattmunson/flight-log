#!/bin/sh
# Runs on every `docker compose up` for the api service.
set -e
cd /app/apps/api

# Pick up schema changes made since the image was built.
npx prisma generate >/dev/null
npx prisma migrate deploy
# Seeds the default user always, and reference data only when the tables are empty.
npm run --silent seed:reference:if-empty
# Idempotent: creates family rows and assigns a family to any aircraft type without one.
npm run --silent seed:aircraft-families

exec npm run dev
