#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 VPS (Hetzner CX22, DigitalOcean $6 droplet). Run as root from a copy of
# this deploy/ folder; safe to run again (it only adds what is missing and refreshes the files it owns):
#   scp -r deploy root@SERVER:/root/ && ssh root@SERVER 'bash /root/deploy/bootstrap.sh'
# Optional settings (environment variables):
#   DOMAIN=intel.example.com   your domain (its A record must point at this server); default <ip>.sslip.io
#   REPO_URL=...               default https://github.com/Jhsiehm/Tradesimple-intel.git
#   BRANCH=main  ADMIN_USER=deploy  NODE_MAJOR=22  SWAP_SIZE=2G
# It never asks for or prints a key. Secrets are added afterwards with tradesimple-env (see README).
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DOMAIN=${DOMAIN:-}
REPO_URL=${REPO_URL:-https://github.com/Jhsiehm/Tradesimple-intel.git}
BRANCH=${BRANCH:-main}
ADMIN_USER=${ADMIN_USER:-deploy}
NODE_MAJOR=${NODE_MAJOR:-22}
SWAP_SIZE=${SWAP_SIZE:-2G}
APP_USER=tradesimple
APP_HOME=/srv/tradesimple
APP=$APP_HOME/app

say() { printf '\n== %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
# shellcheck source=/dev/null
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "warning: tested on Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}" >&2
for f in Caddyfile tradesimple.service env.example update.sh env-merge.sh backup.sh; do
  [ -f "$HERE/$f" ] || { echo "Missing $HERE/$f: copy the whole deploy/ folder." >&2; exit 1; }
done
export DEBIAN_FRONTEND=noninteractive

say "Packages"
apt-get update -q
apt-get -yq upgrade
apt-get install -yq --no-install-recommends ca-certificates curl gnupg git ufw fail2ban python3-systemd \
  unattended-upgrades sqlite3 debian-keyring debian-archive-keyring apt-transport-https cron

say "Swap ($SWAP_SIZE) for small boxes"
if ! swapon --show | grep -q . && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 3000000 ]; then
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/90-tradesimple-swap.conf
  sysctl -q -p /etc/sysctl.d/90-tradesimple-swap.conf
fi

say "Users: $ADMIN_USER (you, ssh + sudo for deploys) and $APP_USER (runs the app, no login)"
if ! id "$ADMIN_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$ADMIN_USER"
fi
if [ -s /root/.ssh/authorized_keys ] && [ ! -s "/home/$ADMIN_USER/.ssh/authorized_keys" ]; then
  install -d -m 700 -o "$ADMIN_USER" -g "$ADMIN_USER" "/home/$ADMIN_USER/.ssh"
  install -m 600 -o "$ADMIN_USER" -g "$ADMIN_USER" /root/.ssh/authorized_keys "/home/$ADMIN_USER/.ssh/authorized_keys"
fi
if ! id "$APP_USER" >/dev/null 2>&1; then
  adduser --system --group --home "$APP_HOME" --shell /usr/sbin/nologin "$APP_USER"
fi
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$APP_HOME"
cat > /etc/sudoers.d/tradesimple <<EOF
$ADMIN_USER ALL=(root) NOPASSWD: /usr/local/sbin/tradesimple-update, /usr/local/sbin/tradesimple-update *, /usr/local/sbin/tradesimple-env *, /usr/local/sbin/tradesimple-backup, /usr/bin/systemctl restart tradesimple, /usr/bin/systemctl status tradesimple, /usr/bin/journalctl -u tradesimple *
EOF
chmod 440 /etc/sudoers.d/tradesimple
visudo -cq

say "SSH: keys only"
if [ -s "/home/$ADMIN_USER/.ssh/authorized_keys" ]; then
  cat > /etc/ssh/sshd_config.d/10-tradesimple.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  sshd -t && systemctl reload ssh
else
  echo "No SSH key found for root, so password login stays on. Add a key and re-run to turn it off." >&2
fi

say "Firewall: 22, 80, 443"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
ufw status | sed -n '1,12p'

say "fail2ban: ssh and app sign-in"
cat > /etc/fail2ban/filter.d/tradesimple-login.conf <<'EOF'
[Definition]
failregex = ^.*intel auth: failed login from <HOST>$
journalmatch = _SYSTEMD_UNIT=tradesimple.service
EOF
cat > /etc/fail2ban/jail.d/tradesimple.local <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
bantime = 1h

[tradesimple-login]
enabled = true
backend = systemd
filter = tradesimple-login
port = http,https
maxretry = 10
findtime = 15m
bantime = 1h
EOF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban

say "Automatic security updates (reboot at 04:30 UTC when a kernel update needs it)"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/52tradesimple-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades >/dev/null

say "journald: cap logs at 300 MB"
install -d /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=300M\n' > /etc/systemd/journald.conf.d/tradesimple.conf
systemctl restart systemd-journald

say "Node.js $NODE_MAJOR"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh >/dev/null
  apt-get install -yq nodejs
  rm -f /tmp/nodesource_setup.sh
fi
node -v

say "Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -yq caddy
fi
caddy version

say "Hostname and address"
IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
case "$IP" in 10.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|192.168.*|"") IP=$(curl -fsS4 --max-time 5 https://api.ipify.org || true) ;; esac
HOST=${DOMAIN:-${IP//./-}.sslip.io}
if [ -z "$HOST" ] || [ "$HOST" = ".sslip.io" ]; then
  echo "Could not work out the public IP; set DOMAIN=..." >&2
  exit 1
fi
ORIGIN="https://$HOST"
echo "serving at $ORIGIN"

say "App code ($REPO_URL, $BRANCH)"
if [ ! -d "$APP/.git" ]; then
  runuser -u "$APP_USER" -- git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP"
else
  runuser -u "$APP_USER" -- git -C "$APP" remote set-url origin "$REPO_URL"
fi
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$APP/data"

say "Helpers in /usr/local/sbin (root-owned)"
install -m 755 "$HERE/update.sh" /usr/local/sbin/tradesimple-update
install -m 755 "$HERE/env-merge.sh" /usr/local/sbin/tradesimple-env
install -m 755 "$HERE/backup.sh" /usr/local/sbin/tradesimple-backup

say "Environment file /etc/tradesimple/env (600, root)"
install -d -m 700 /etc/tradesimple
if [ ! -f /etc/tradesimple/env ]; then
  sed "s#__ORIGIN__#$ORIGIN#" "$HERE/env.example" > /etc/tradesimple/env
else
  if grep -q '^PUBLIC_ORIGIN=' /etc/tradesimple/env; then
    sed -i "s#^PUBLIC_ORIGIN=.*#PUBLIC_ORIGIN=$ORIGIN#" /etc/tradesimple/env
  else
    echo "PUBLIC_ORIGIN=$ORIGIN" >> /etc/tradesimple/env
  fi
fi
chown root:root /etc/tradesimple/env
chmod 600 /etc/tradesimple/env

say "systemd unit"
install -m 644 "$HERE/tradesimple.service" /etc/systemd/system/tradesimple.service
systemctl daemon-reload

say "Build (npm ci + vite build; a few minutes on 1 vCPU)"
/usr/local/sbin/tradesimple-update "origin/$BRANCH"

say "Caddy site"
sed "s#__HOST__#$HOST#" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
install -d -o caddy -g caddy /var/log/caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable --now caddy >/dev/null
systemctl reload caddy

say "Daily backup at 03:30 UTC (keeps 7)"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" /var/backups/tradesimple
cat > /etc/cron.d/tradesimple <<'EOF'
SHELL=/bin/bash
30 3 * * * tradesimple INTEL_CACHE=/var/lib/tradesimple/cache.sqlite /usr/local/sbin/tradesimple-backup 2>&1 | systemd-cat -t tradesimple-backup
EOF
chmod 644 /etc/cron.d/tradesimple

say "Done"
if grep -q '^INTEL_PASSWORD_HASH=.' /etc/tradesimple/env; then
  systemctl enable --now tradesimple >/dev/null
  echo "Open $ORIGIN and sign in."
else
  systemctl disable --now tradesimple >/dev/null 2>&1 || true
  cat <<EOF
The app is built but stopped until sign-in is set. On your laptop:
  npm run -s auth:hash > /tmp/intel-auth.env     # add -- --totp for an authenticator code
  scp /tmp/intel-auth.env $ADMIN_USER@$IP:/tmp/intel-auth.env && rm /tmp/intel-auth.env
  ssh $ADMIN_USER@$IP sudo tradesimple-env /tmp/intel-auth.env
  scp .env.local $ADMIN_USER@$IP:/tmp/intel.env && ssh $ADMIN_USER@$IP sudo tradesimple-env /tmp/intel.env
Then open $ORIGIN
EOF
fi
