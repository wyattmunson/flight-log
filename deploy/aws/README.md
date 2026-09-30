# AWS resources for the Lightsail deploy

Everything the cluster needs from AWS, created by [`provision.sh`](provision.sh). Defaults:
us-east-1a, 4 GB instance (`medium_3_0`), 20 GB data disk. Override with env vars (top of the script).

## What gets created

| Resource                        | Details                                                                                                                     | Approx. cost             |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Lightsail instance `flight-log` | Ubuntu 24.04, 4 GB RAM / 2 vCPU / 80 GB SSD, IPv4, ~4 TB transfer included                                                  | ~$24/mo                  |
| Static IP `flight-log-ip`       | Attached to the instance. Survives stop/start; free while attached (billed if left unattached)                              | $0                       |
| Data disk `flight-log-data`     | 20 GB block disk, same AZ. Holds k3s volumes (Postgres, Traefik cert store); mounted by `install-k3s.sh`                    | ~$2/mo                   |
| Auto-snapshots of the disk      | Daily at 06:00 UTC, 7 retained. Crash-consistent safety net, not a substitute for logical backups                           | ~$1/mo                   |
| Key pair `flight-log-kp`        | An existing Lightsail key pair (create it first, see below), used as-is (not created, changed or deleted by the script)     | $0                       |
| Firewall                        | 22 from **your current IP only**, 80 and 443 from anywhere. 6443 (Kubernetes API) stays closed                              | $0                       |
| Route 53 record                 | `A flights.wyattmunson.com` → static IP, TTL 300, **in your existing hosted zone**. Plain record, not an alias, not proxied | $0 (zone already exists) |

Total: about **$27/mo**. Everything is in one AZ, which is what a single-node setup implies.

Not created yet: the backup bucket (S3 or R2) for CloudNativePG backups. That comes with the backup work.

## Before you run it

1. **AWS credentials.** `~/.aws` already exists on this machine, so you may have working
   credentials. Check with `aws sts get-caller-identity`. If not:
   - Preferred: IAM Identity Center (`aws configure sso`).
   - Otherwise: a dedicated IAM user (never the root account) with MFA and the policy in
     [`iam-policy.json`](iam-policy.json). Replace `REPLACE_WITH_ZONE_ID` with your hosted zone ID
     (`aws route53 list-hosted-zones-by-name --dns-name wyattmunson.com`), attach it, create an
     access key, and run `aws configure --profile flight-log` (then `export AWS_PROFILE=flight-log`).
     Treat the key as a password: it can create billable resources.
2. **Region** is `us-east-1` (`AWS_REGION` to change; the AZ follows).
3. **A billing guardrail** (recommended): AWS Budgets → a $40/mo budget with an email alert at 80%.
4. **Key pair.** The script uses your existing Lightsail key pair `flight-log-kp` (override with
   `KEY_PAIR=...`). It must exist in **Lightsail** in `us-east-1`: Lightsail and EC2 key pairs are
   separate, and Lightsail ones are per region. Check with `aws lightsail get-key-pairs`. You need the
   matching **private key file** (`.pem`) locally; see [Where the key is used](#where-the-key-is-used).

## Run it

```bash
deploy/aws/provision.sh
```

It validates the bundle, blueprint and hosted zone, prints the plan with prices, and waits for a `y`
before creating anything. Re-running is safe: existing resources are reused, and the firewall and
DNS record are re-applied (so re-run after your home IP changes to update the SSH rule).

Then continue with [`../README.md`](../README.md) step 2. On the VM, `lsblk` should show the data disk
as `nvme1n1` (pass it as `DATA_DEVICE`).

## Where the key is used

The private key file for `flight-log-kp` is the only way into the VM (password login is off).
You need it locally, with `chmod 600`, for every SSH-based step in [`../README.md`](../README.md):

- `scp` of `install-k3s.sh` and the `ssh ... sudo bash install-k3s.sh` install (step 2)
- fetching the kubeconfig and opening the `-L 6443` tunnel that `kubectl` uses (step 3, and every
  time you run `kubectl` later)
- ad hoc debugging on the box

Rather than typing `-i` each time, add this to `~/.ssh/config` (adjust the path), and the
commands in the deploy README work as written:

```
Host flight-log
  HostName <static IP from provision.sh>
  User ubuntu
  IdentityFile ~/.ssh/flight-log-kp.pem
  IdentitiesOnly yes
```

Then `ssh flight-log`, `scp ... flight-log:`, and `ssh -N -L 6443:127.0.0.1:6443 flight-log`.
If you no longer have the private key, Lightsail can't re-issue it; create a new key pair and
re-run with `KEY_PAIR=<new name>` on a new instance.

## Notes

- **SSH from elsewhere.** The firewall allows only the IP you ran the script from. For another
  address, re-run with `SSH_CIDR=203.0.113.7/32`, or use the Lightsail console's browser SSH.
- **Bundle IDs change over time.** If `medium_3_0` disappears, the script says so; list current
  ones with `aws lightsail get-bundles --query 'bundles[].[bundleId,ramSizeInGb,price]' --output table`.
- **Resizing** later means snapshotting the instance and creating a larger one from it, then moving
  the static IP and disk. It's a reason to keep the manifests, not the VM, as the source of truth.
- **The script has not been run** against a live account. It passes a syntax check and the CLI
  flags were checked against `aws lightsail ... help`; expect to fix small things on the first run.

## Tear down

Lightsail bills even for stopped instances, so delete rather than stop. This destroys the data disk.

```bash
aws lightsail delete-instance --instance-name flight-log --force-delete-add-ons
aws lightsail release-static-ip --static-ip-name flight-log-ip
aws lightsail delete-disk --disk-name flight-log-data --force-delete-add-ons
# then remove the A record for flights.wyattmunson.com from Route 53
```
