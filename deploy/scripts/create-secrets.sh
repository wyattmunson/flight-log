#!/usr/bin/env bash
# Creates the secrets the manifests expect. Safe to re-run: an existing DB password is reused, so
# re-running never rotates it. Run against the cluster (kubectl context) BEFORE applying
# deploy/k8s/platform and deploy/k8s/apps/flight-log.
#
#   deploy/scripts/create-secrets.sh
# App logins are not secrets in the cluster: create them with the user:create CLI (deploy/README.md).
set -euo pipefail

apply() { kubectl apply -f -; }

kubectl create namespace databases --dry-run=client -o yaml | apply
kubectl create namespace flight-log --dry-run=client -o yaml | apply

# Postgres role password: reuse if it already exists, else generate (hex, so it's URL-safe).
if existing=$(kubectl -n databases get secret flight-log-db-credentials -o jsonpath='{.data.password}' 2>/dev/null) && [ -n "$existing" ]; then
  db_pass=$(printf '%s' "$existing" | base64 -d)
else
  db_pass=$(openssl rand -hex 24)
fi

# Read by CloudNativePG (managed role) in the databases namespace.
kubectl -n databases create secret generic flight-log-db-credentials \
  --type=kubernetes.io/basic-auth \
  --from-literal=username=flight_log \
  --from-literal=password="$db_pass" \
  --dry-run=client -o yaml | kubectl label --local -f - cnpg.io/reload=true -o yaml | apply

# Read by the API in the flight-log namespace.
url="postgresql://flight_log:${db_pass}@platform-pg-rw.databases.svc.cluster.local:5432/flightlog"
kubectl -n flight-log create secret generic flight-log-db \
  --from-literal=DATABASE_URL="$url" \
  --dry-run=client -o yaml | apply

echo "Secrets applied."
