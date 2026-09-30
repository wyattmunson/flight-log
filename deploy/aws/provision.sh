#!/usr/bin/env bash
# Creates the AWS side of the deploy: a Lightsail instance, static IP, data disk, firewall rules,
# daily disk snapshots, and the Route 53 A record. Idempotent: existing resources are reused.
# It prints a plan and asks before creating anything (this costs money).
#
#   deploy/aws/provision.sh              # uses the defaults below
#   BUNDLE=small_3_0 deploy/aws/provision.sh
#
# Requires: aws CLI v2 with credentials (see deploy/aws/README.md), curl.
set -euo pipefail

: "${AWS_REGION:=us-east-1}"
: "${AZ:=${AWS_REGION}a}"
: "${NAME:=flight-log}"                    # instance name; also the prefix for the disk and IP
: "${KEY_PAIR:=flight-log-kp}"          # existing Lightsail key pair (must be in $AWS_REGION)
: "${BLUEPRINT:=ubuntu_24_04}"
: "${BUNDLE:=medium_3_0}"                  # 4 GB / 2 vCPU / 80 GB SSD. small_3_0 = 2 GB.
: "${DISK_GB:=20}"                         # data disk for k3s volumes (Postgres, cert store)
: "${ZONE_NAME:=wyattmunson.com}"          # existing Route 53 public hosted zone
: "${HOSTNAME_FQDN:=flights.wyattmunson.com}"
: "${SNAPSHOT_TIME_UTC:=06:00}"            # daily automatic disk snapshot
: "${DISK_PATH:=/dev/xvdf}"                # Lightsail's name for the disk; shows up as nvme1n1 on the VM

export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION" AWS_PAGER=""
ls_() { aws lightsail "$@"; }

for tool in aws curl; do command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }; done
aws sts get-caller-identity --query Arn --output text >/dev/null 2>&1 \
  || { echo "AWS credentials not working: see deploy/aws/README.md" >&2; exit 1; }

# --- inputs ----------------------------------------------------------------
# Lightsail key pairs are separate from EC2 key pairs and are per region.
ls_ get-key-pair --key-pair-name "$KEY_PAIR" >/dev/null 2>&1 \
  || { echo "no Lightsail key pair '$KEY_PAIR' in $AWS_REGION (EC2 key pairs don't count). List: aws lightsail get-key-pairs" >&2; exit 1; }

# SSH is limited to your current public IP. Override with SSH_CIDR (e.g. a Tailscale exit or VPN range).
SSH_CIDR="${SSH_CIDR:-$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')/32}"

ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$ZONE_NAME" \
  --query "HostedZones[?Name=='${ZONE_NAME}.' && Config.PrivateZone==\`false\`]|[0].Id" --output text)
[ -n "$ZONE_ID" ] && [ "$ZONE_ID" != "None" ] \
  || { echo "no public Route 53 hosted zone named $ZONE_NAME in this account" >&2; exit 1; }
ZONE_ID=${ZONE_ID##*/}

bundle=$(ls_ get-bundles --query "bundles[?bundleId=='$BUNDLE']|[0].[ramSizeInGb,cpuCount,diskSizeInGb,price]" --output text)
[ -n "$bundle" ] && [ "$bundle" != "None" ] || { echo "unknown bundle $BUNDLE (aws lightsail get-bundles)" >&2; exit 1; }
ls_ get-blueprints --query "blueprints[?blueprintId=='$BLUEPRINT']|[0].name" --output text | grep -qv '^None$' \
  || { echo "unknown blueprint $BLUEPRINT (aws lightsail get-blueprints)" >&2; exit 1; }
read -r ram cpu sysdisk price <<<"$bundle"

cat <<PLAN
About to create (region $AWS_REGION, zone $AZ):
  Lightsail instance  $NAME        $BLUEPRINT, $BUNDLE = ${ram} GB RAM / ${cpu} vCPU / ${sysdisk} GB, \$${price}/mo
  Static IP           $NAME-ip     free while attached
  Data disk           $NAME-data   ${DISK_GB} GB (~\$$(awk "BEGIN{print $DISK_GB*0.10}")/mo) + daily auto-snapshots at ${SNAPSHOT_TIME_UTC} UTC
  SSH key pair        $KEY_PAIR    (existing; not modified)
  Firewall            22 from $SSH_CIDR; 80, 443 from anywhere
  Route 53            A $HOSTNAME_FQDN -> <static IP> in zone $ZONE_NAME ($ZONE_ID)
PLAN
read -r -p "Proceed? [y/N] " ans
[ "$ans" = "y" ] || { echo "aborted"; exit 1; }

# --- resources -------------------------------------------------------------
have() { "$@" >/dev/null 2>&1; }

if ! have ls_ get-instance --instance-name "$NAME"; then
  ls_ create-instances --instance-names "$NAME" --availability-zone "$AZ" \
    --blueprint-id "$BLUEPRINT" --bundle-id "$BUNDLE" --key-pair-name "$KEY_PAIR" \
    --ip-address-type ipv4 --tags key=app,value=flight-log >/dev/null
fi
echo -n "waiting for instance to run"
until [ "$(ls_ get-instance --instance-name "$NAME" --query instance.state.name --output text)" = running ]; do
  echo -n .; sleep 5
done; echo

have ls_ get-static-ip --static-ip-name "$NAME-ip" || ls_ allocate-static-ip --static-ip-name "$NAME-ip" >/dev/null
[ "$(ls_ get-static-ip --static-ip-name "$NAME-ip" --query staticIp.isAttached --output text)" = True ] \
  || ls_ attach-static-ip --static-ip-name "$NAME-ip" --instance-name "$NAME" >/dev/null
IP=$(ls_ get-static-ip --static-ip-name "$NAME-ip" --query staticIp.ipAddress --output text)

have ls_ get-disk --disk-name "$NAME-data" \
  || ls_ create-disk --disk-name "$NAME-data" --availability-zone "$AZ" --size-in-gb "$DISK_GB" >/dev/null
echo -n "waiting for disk"
until [ "$(ls_ get-disk --disk-name "$NAME-data" --query disk.state --output text)" = available ] \
  || [ "$(ls_ get-disk --disk-name "$NAME-data" --query disk.isAttached --output text)" = True ]; do
  echo -n .; sleep 3
done; echo
[ "$(ls_ get-disk --disk-name "$NAME-data" --query disk.isAttached --output text)" = True ] \
  || ls_ attach-disk --disk-name "$NAME-data" --instance-name "$NAME" --disk-path "$DISK_PATH" >/dev/null

# Replaces the whole rule set (Lightsail defaults to 22 and 80 open to the world).
ls_ put-instance-public-ports --instance-name "$NAME" --port-infos \
  "fromPort=22,toPort=22,protocol=tcp,cidrs=$SSH_CIDR" \
  "fromPort=80,toPort=80,protocol=tcp,cidrs=0.0.0.0/0" \
  "fromPort=443,toPort=443,protocol=tcp,cidrs=0.0.0.0/0" >/dev/null

# Enabling an add-on that's already on is an error, so ignore that case.
ls_ enable-add-on --resource-name "$NAME-data" \
  --add-on-request "addOnType=AutoSnapshot,autoSnapshotAddOnRequest={snapshotTimeOfDay=$SNAPSHOT_TIME_UTC}" >/dev/null 2>&1 || true

aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "$(cat <<JSON
{"Comment":"flight-log","Changes":[{"Action":"UPSERT","ResourceRecordSet":{
  "Name":"$HOSTNAME_FQDN","Type":"A","TTL":300,"ResourceRecords":[{"Value":"$IP"}]}}]}
JSON
)" >/dev/null

cat <<DONE

Done.
  Static IP : $IP
  DNS       : $HOSTNAME_FQDN -> $IP (TTL 300; may take a few minutes to propagate)
  SSH       : ssh -i <path to the private key for $KEY_PAIR> ubuntu@$IP   (from $SSH_CIDR only)
  Next      : deploy/README.md step 2 (install k3s). Find the data disk with 'lsblk' on the VM
              (expect nvme1n1) and pass it as DATA_DEVICE.
DONE
