#!/bin/sh
# Production start: migrate → seed (idempotent) → serve. Mirrors docker/api-entrypoint.sh (dev).
set -e
cd /app/apps/api

npm run --silent db:migrate
# Seeds the default user always, and reference data only when the tables are empty
# (the first boot downloads OurAirports/OpenFlights, so it needs outbound internet).
npm run --silent seed:reference:if-empty
npm run --silent seed:aircraft-families

exec /app/node_modules/.bin/tsx src/index.ts
