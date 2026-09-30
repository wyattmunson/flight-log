# Deploying to a Lightsail VM (k3s + CloudNativePG)

Target: **https://flights.wyattmunson.com** on one Lightsail instance running single-node k3s,
with a shared CloudNativePG Postgres, fronted by k3s's bundled Traefik (Let's Encrypt TLS, HTTP
basic auth). Sizing and cost rationale are in the conversation history; short version: a 2 GB
instance (~$12/mo) fits this, 4 GB is the comfortable size for more apps.

```
Internet ─► DNS A record ─► Lightsail static IP :80/:443
                              └─ k3s (single node)
                                  ├─ kube-system:   Traefik  (TLS, redirect, basic auth)
                                  ├─ flight-log:    web (nginx, static SPA)  api (Express)
                                  ├─ databases:     platform-pg (CloudNativePG, 1 instance)
                                  └─ cnpg-system:   CloudNativePG operator
```

Nothing here has been run against a real cluster yet. The two images are built and smoke-tested
locally (see [Verifying](#verifying)), and the manifests render with `kubectl kustomize`, but
expect to iterate on the first real apply.

## Layout

| Path                              | What                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `docker/`                         | Production `api` / `web` Dockerfiles, API entrypoint (migrate → seed → serve), nginx config                        |
| `bootstrap/install-k3s.sh`        | One-time node setup: optional data-disk mount, unattended upgrades, k3s install                                    |
| `scripts/create-secrets.sh`       | Creates the DB password, `DATABASE_URL` and basic-auth secrets (idempotent, never rotates an existing DB password) |
| `k8s/platform/cnpg-operator/`     | Pinned CloudNativePG operator (v1.30.1)                                                                            |
| `k8s/platform/`                   | Traefik ACME config + the shared `platform-pg` Postgres cluster and per-app roles/databases                        |
| `k8s/apps/flight-log/`            | Namespace, api + web Deployments/Services, Traefik middlewares and routes                                          |
| `../.github/workflows/images.yml` | Builds and pushes `ghcr.io/wyattmunson/flight-log-{api,web}` on every push to `main`                               |

## One-time setup

### 0. Before you start

- **Images.** Push to `main` (or run the `images` workflow). GHCR packages are private the first
  time: on GitHub, open each package (`flight-log-api`, `flight-log-web`) → Package settings →
  set visibility to **Public** so the cluster can pull without credentials. The images contain no
  secrets or data.
- **Edit** `k8s/platform/traefik-config.yaml`: replace `you@example.com` with the address for
  Let's Encrypt expiry notices.
- The Lightsail firewall should allow only 22 (ideally restricted to your IP), 80 and 443.
  Never expose 6443.

### 1. Provision (AWS)

Run `deploy/aws/provision.sh` (see [aws/README.md](aws/README.md)): it creates an Ubuntu 24.04 instance (4 GB), static IP, data disk, firewall rules and the Route 53 record.
The record is DNS-only (Route 53 is never a proxy), which Traefik's HTTP-01 challenge requires.

### 2. Install k3s on the instance

```bash
# Use `-i <key.pem>` or a `flight-log` Host entry in ~/.ssh/config (see aws/README.md)
scp -i <key.pem> deploy/bootstrap/install-k3s.sh ubuntu@<ip>:
ssh -i <key.pem> ubuntu@<ip> 'sudo DATA_DEVICE=/dev/nvme1n1 bash install-k3s.sh'   # drop DATA_DEVICE to skip the disk
```

Check the device name with `lsblk` first. The script formats the disk only if it has no
filesystem, and mounts it where k3s stores volumes.

### 3. Get a kubeconfig on your laptop

The API server listens on the instance only. Tunnel to it:

```bash
ssh -i <key.pem> ubuntu@<ip> 'sudo cat /etc/rancher/k3s/k3s.yaml' > ~/.kube/flight-log.yaml   # server: https://127.0.0.1:6443
ssh -i <key.pem> -N -L 6443:127.0.0.1:6443 ubuntu@<ip> &                                        # keep this running
export KUBECONFIG=~/.kube/flight-log.yaml
kubectl get nodes
```

### 4. Install the database operator, then the platform and app

```bash
kubectl apply --server-side -k deploy/k8s/platform/cnpg-operator
kubectl -n cnpg-system rollout status deploy/cnpg-controller-manager

deploy/scripts/create-secrets.sh <basic-auth-username>     # prompts for the password

kubectl apply -k deploy/k8s/platform                       # Traefik config + platform-pg
kubectl -n databases wait --for=condition=Ready cluster/platform-pg --timeout=300s
kubectl apply -k deploy/k8s/apps/flight-log
kubectl -n flight-log rollout status deploy/api            # first boot seeds ~12k airports (needs internet)
```

Then open https://flights.wyattmunson.com and sign in with the basic-auth credentials. The first
request triggers the certificate; if it doesn't arrive, check `kubectl -n kube-system logs deploy/traefik`.
Use the staging CA line in `traefik-config.yaml` while debugging to avoid rate limits.

## Day to day

```bash
# Deploy a new build (after the images workflow finishes)
kubectl -n flight-log rollout restart deploy/api deploy/web

# Roll back / pin: set newTag to sha-<commit> in k8s/apps/flight-log/kustomization.yaml, then
kubectl apply -k deploy/k8s/apps/flight-log

kubectl -n flight-log logs deploy/api -f
kubectl -n databases get cluster,pods
kubectl -n databases exec -it platform-pg-1 -c postgres -- psql -d flightlog     # ad hoc SQL
```

Migrations run automatically on every API start (`prisma migrate deploy`).

## Adding another app to the node

1. New namespace + Deployment/Service/IngressRoute under `k8s/apps/<app>/` (copy `flight-log`).
   Point its DNS name at the same IP; add its own basic-auth (or real auth) middleware.
2. If it needs Postgres: add a credentials secret in `databases`, a role in
   `k8s/platform/postgres/cluster.yaml`, and a `Database` in `postgres/databases/`. Its
   `DATABASE_URL` host is `platform-pg-rw.databases.svc.cluster.local`.
3. Watch memory: `kubectl top nodes` (k3s itself takes ~0.5–1 GB).

## Notes and limits

- **Single node, no HA.** Reboots mean brief downtime. Fine for one user.
- **No backups yet.** Data lives on the node's disk (or the attached disk). Backups are the next step;
  the place is `k8s/platform/postgres/cluster.yaml` (CNPG `backup.barmanObjectStore` to S3/R2 plus a
  `ScheduledBackup`). Until then, enable Lightsail automatic snapshots on the disk, or take a manual
  dump: `kubectl -n databases exec platform-pg-1 -c postgres -- pg_dump -Fc flightlog > flightlog.dump`.
- **Import previews are in memory** (AGENTS.md), so the API is pinned to 1 replica with the
  `Recreate` strategy; a deploy drops any pending import preview.
- **Auth is a stopgap.** The app has no accounts; basic auth is the only gate. Swagger UI is off
  (`ENABLE_API_DOCS=false` in the kustomization).
- **First boot needs outbound internet** to download OurAirports/OpenFlights data. If that fails the
  pod crash-loops with a clear message; it retries on restart.
- **Reference data license:** the deployed DB contains OurAirports (public domain) and OpenFlights
  (ODbL) data; see the README's license notes.
- **Rotating basic-auth credentials:** re-run `create-secrets.sh` (the DB password is kept).
- **Rotating the DB password:** delete the `flight-log-db-credentials` and `flight-log-db` secrets,
  re-run `create-secrets.sh`, then `kubectl -n flight-log rollout restart deploy/api`.

## Verifying

Local smoke test used to validate the images (read-only root fs, non-root, all capabilities
dropped, as the pods run):

```bash
docker build -f deploy/docker/api.Dockerfile -t flight-log-api .
docker build -f deploy/docker/web.Dockerfile -t flight-log-web .
docker network create fltest
docker run -d --name pg --network fltest -e POSTGRES_USER=flight_log -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=flightlog postgres:16
docker run -d --name api --network fltest --read-only --tmpfs /tmp --user 1000 --cap-drop ALL \
  -e DATABASE_URL=postgresql://flight_log:pw@pg:5432/flightlog flight-log-api
docker run -d --name web --network fltest --read-only --tmpfs /tmp --cap-drop ALL flight-log-web
```

Render the manifests without a cluster: `kubectl kustomize deploy/k8s/apps/flight-log`.
