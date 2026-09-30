# Deploy follow-ups (2026-09-30)

Open items after the first Lightsail + k3s + CloudNativePG deployment. See
[`docs/release-notes/2026-09-30.md`](../release-notes/2026-09-30.md) for what was set up and the
pitfalls hit along the way, and [`deploy/README.md`](../../deploy/README.md) for the runbook.

Priority order: finish the deploy, protect the data, then everything else.

## Finish the current deploy

- [ ] **Confirm the rollout end to end.** `platform-pg` is Ready, the `api` rollout completed,
      https://flights.wyattmunson.com serves over HTTPS with a valid certificate, and basic auth prompts.
      Then update the status paragraph in the release notes.
- [ ] **Commit and push the uncommitted work:** the `traefik-config.yaml` fix (the `chown` was removed;
      already applied from the working tree), the `README.md` doc-map line, and the release notes.
- [ ] **Switch to the real Let's Encrypt certificate** if the staging CA line was used: remove it from
      `deploy/k8s/platform/traefik-config.yaml`, re-apply, delete `/data/acme.json` in the Traefik pod, and
      restart Traefik.

## Data safety

- [ ] **Backups.** Today the only protection is daily Lightsail disk snapshots, which are
      crash-consistent. Add `backup.barmanObjectStore` and a `ScheduledBackup` to
      `deploy/k8s/platform/postgres/cluster.yaml`, targeting S3 or R2 (needs a bucket plus scoped
      credentials stored as a secret). Decide S3 vs R2 first.
- [ ] **Test a restore** from those backups into a scratch cluster. An untested backup isn't a backup.
- [ ] **Pin the Postgres image** to a specific tag. `ghcr.io/cloudnative-pg/postgresql:16` floats across
      minor versions, so a pod restart could change the version.

## Security

- [ ] **Auth is only HTTP basic auth** at Traefik, with no rate limiting, and the app treats every
      request as one seeded user. Fine for one user; decide whether real auth belongs on the roadmap.
- [ ] **Tighten the IAM policy.** `deploy/aws/iam-policy.json` grants `lightsail:*`, and its
      `REPLACE_WITH_ZONE_ID` placeholder must be filled in if that policy is used.
- [ ] **Set an AWS Budget alarm** (about $40/mo, email at 80%).

## Operations

- [ ] **Deploy workflow.** Deploys use the `latest` tag plus `kubectl rollout restart`. Pin
      `sha-<commit>` tags in `deploy/k8s/apps/flight-log/kustomization.yaml` for real rollbacks.
      Optionally have CI apply manifests (requires giving CI cluster access).
- [ ] **Monitoring.** Nothing watches the box. Add an uptime check on the site and a disk-usage alert
      for the data volume.
- [ ] **Upgrade plan.** k3s tracks the `stable` channel, the CloudNativePG operator is pinned at
      v1.30.1, and Ubuntu patches itself. Decide how and when to upgrade k3s and the operator.
- [ ] **SSH is limited to one IP.** When your IP changes, re-run `deploy/aws/provision.sh` or edit the
      Lightsail firewall rule.

## Repo hygiene

- [ ] **Untested scripts.** `deploy/bootstrap/install-k3s.sh` and `deploy/scripts/create-secrets.sh`
      were never run (the steps were done by hand). Test them somewhere disposable or delete them.
- [ ] **Doc drift.** `deploy/README.md` still describes the script-based flow. Update it to match the
      commands that actually worked (see the release notes).
- [ ] **Document the `Recreate` behavior.** Every deploy drops pending import previews (they are
      in memory). Add a line to the user-facing docs.

## If the setup grows

- **A second app on the node:** check memory first (`kubectl top nodes`; k3s itself uses about
  0.5-1 GB), then add a role in `cluster.yaml` and a `Database` in `postgres/databases/`.
- **Resizing the instance:** snapshot it and create a larger one, then move the static IP and data
  disk. Keep the manifests, not the VM, as the source of truth.
