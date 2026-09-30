#!/usr/bin/env bash
# One-time node setup for a fresh Ubuntu Lightsail instance. Run as root on the instance:
#   sudo DATA_DEVICE=/dev/nvme1n1 bash install-k3s.sh
#
# DATA_DEVICE (optional): a separate block disk to hold all PersistentVolumes (Postgres, Traefik's
#   certs). It is formatted ext4 ONLY if it has no filesystem yet, then mounted where k3s's
#   local-path provisioner stores volumes. With this, the instance can be rebuilt and the disk
#   re-attached. Without it, volumes live on the instance's system disk.
# K3S_CHANNEL (optional): k3s release channel, default "stable".
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }

STORAGE_DIR=/var/lib/rancher/k3s/storage
mkdir -p "$STORAGE_DIR"

if [ -n "${DATA_DEVICE:-}" ]; then
  [ -b "$DATA_DEVICE" ] || { echo "$DATA_DEVICE is not a block device" >&2; exit 1; }
  if ! blkid "$DATA_DEVICE" >/dev/null 2>&1; then
    echo "Formatting $DATA_DEVICE as ext4 (no filesystem found)"
    mkfs.ext4 -L k3s-storage "$DATA_DEVICE"
  fi
  uuid=$(blkid -s UUID -o value "$DATA_DEVICE")
  grep -q "$uuid" /etc/fstab || echo "UUID=$uuid $STORAGE_DIR ext4 defaults,nofail 0 2" >>/etc/fstab
  mountpoint -q "$STORAGE_DIR" || mount "$STORAGE_DIR"
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades

# The API server stays on localhost; reach it through an SSH tunnel (see deploy/README.md).
mkdir -p /etc/rancher/k3s
cat >/etc/rancher/k3s/config.yaml <<'CONF'
write-kubeconfig-mode: "0600"
secrets-encryption: true
CONF

curl -sfL https://get.k3s.io | INSTALL_K3S_CHANNEL="${K3S_CHANNEL:-stable}" sh -

echo
echo "k3s is up. Kubeconfig: /etc/rancher/k3s/k3s.yaml (see deploy/README.md to use it from your laptop)."
k3s kubectl get nodes
