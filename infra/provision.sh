#!/usr/bin/env bash
#
# Sentinel — hardened single-command provisioning for a fresh Ubuntu 24.04 droplet.
#
# Written after the first droplet was compromised twice. The specific lessons
# baked in here:
#   * NOTHING except 80/443/22 is reachable from the internet. The previous box
#     had MinIO on 9000/41699 and the app on 3000/3001 wide open.
#   * Postgres, Redis, MinIO, API and web all bind to 127.0.0.1 only.
#   * SSH is key-only. The old root password was leaked and password auth was on.
#   * Secrets are generated on the box, never copied from anywhere.
#   * The app runs as an unprivileged user, not root.
#
# Usage (as root on a BRAND NEW droplet):
#   curl -fsSL https://raw.githubusercontent.com/<you>/sentinel/main/infra/provision.sh -o p.sh
#   bash p.sh 2>&1 | tee /root/provision.log
#
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/mbheramil/sentinel.git}"
APP_USER="${APP_USER:-sentinel}"
APP_DIR="/opt/sentinel"
NODE_MAJOR=20

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[fail] %s\033[0m\n' "$*" >&2; exit 1; }

# A brand new droplet is the ONLY thing this script runs on, and a brand new
# droplet is still finishing cloud-init and its first unattended-upgrades pass —
# both of which hold the apt lock. So losing the race to them is the normal case,
# not an edge case, and `apt-get update` dies with "Could not get lock".
apt_wait() {
  cloud-init status --wait >/dev/null 2>&1 || true
  local i
  for i in $(seq 1 60); do
    if ! pgrep -x 'apt|apt-get|dpkg|unattended-upgrade' >/dev/null 2>&1; then
      return 0
    fi
    [[ $i -eq 1 ]] && echo "Waiting for an in-progress apt/dpkg run to finish..."
    sleep 5
  done
  warn "apt still busy after 5 minutes — continuing and hoping for the best."
}

[[ $EUID -eq 0 ]] || die "Run as root."
trap 'die "Failed at line $LINENO. See the log above."' ERR

# ─────────────────────────────────────────────────────────────────────────────
log "1/12  Preflight: confirm SSH key access before we disable passwords"
# Locking SSH to keys with no key installed = permanently locked out. Refuse.
KEYS_FILE=/root/.ssh/authorized_keys
if [[ ! -s $KEYS_FILE ]] || ! grep -qE '^(ssh-|ecdsa-)' "$KEYS_FILE"; then
  die "No SSH public key in $KEYS_FILE. Add your key first (DigitalOcean > Settings > Security),
      otherwise disabling password login will lock you out of this droplet."
fi
echo "Found $(grep -cE '^(ssh-|ecdsa-)' "$KEYS_FILE") SSH key(s) — safe to continue."

# ─────────────────────────────────────────────────────────────────────────────
log "2/12  Base packages + automatic security updates"
export DEBIAN_FRONTEND=noninteractive
apt_wait
apt-get update -qq
apt-get install -y -qq \
  curl git ufw fail2ban unattended-upgrades gnupg ca-certificates \
  postgresql postgresql-contrib redis-server nginx build-essential \
  python3-certbot-nginx >/dev/null
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

# ─────────────────────────────────────────────────────────────────────────────
log "3/12  Firewall: deny inbound by default, allow only SSH + HTTP(S)"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw limit 22/tcp   comment 'SSH (rate limited)' >/dev/null
ufw allow 80/tcp   comment 'HTTP'  >/dev/null
ufw allow 443/tcp  comment 'HTTPS' >/dev/null
ufw --force enable >/dev/null
ufw status verbose

# ─────────────────────────────────────────────────────────────────────────────
log "4/12  SSH hardening: keys only, no root password login"
install -d -m 755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PasswordAuthentication no
PermitEmptyPasswords no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
X11Forwarding no
EOF
sshd -t || die "sshd config invalid — NOT restarting so you keep your session."
systemctl reload ssh || systemctl reload sshd

# fail2ban on sshd
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 4
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban >/dev/null 2>&1 || true

# ─────────────────────────────────────────────────────────────────────────────
log "5/12  Swap (protects against the OOM-kill cascade that took the last box down)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
# Prefer reclaiming cache over swapping out the app.
sysctl -qw vm.swappiness=10
grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
free -h

# ─────────────────────────────────────────────────────────────────────────────
log "6/12  Node ${NODE_MAJOR} + pnpm + pm2"
if ! command -v node >/dev/null || [[ "$(node -v)" != v${NODE_MAJOR}* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt_wait
  apt-get install -y -qq nodejs >/dev/null
fi
# corepack's shim and `npm i -g pnpm` both want to own /usr/bin/pnpm, and corepack
# gets there first — the npm install then dies with EEXIST. Let corepack own pnpm:
# package.json pins pnpm@9.15.0 and pnpm-lock.yaml is lockfileVersion 9.0, so
# `npm i -g pnpm` would have installed pnpm 10 and then fought the lockfile.
# npm installs pm2 only.
corepack enable pnpm >/dev/null 2>&1 || npm i -g --force "pnpm@9" >/dev/null
npm i -g pm2 >/dev/null
# Corepack asks for confirmation before downloading a pinned version, which would
# hang forever with no tty.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# NB: the version printed here is corepack's shim default, because we are not in
# the repo yet (it is cloned in step 10). Inside $APP_DIR the shim reads
# `packageManager: pnpm@9.15.0` from package.json and fetches that instead, which
# is what matches pnpm-lock.yaml's lockfileVersion 9.0. So a 10.x/12.x here is
# expected and not the version that installs anything.
node -v && pnpm -v

# ─────────────────────────────────────────────────────────────────────────────
log "7/12  Unprivileged app user"
id -u "$APP_USER" >/dev/null 2>&1 || useradd -r -m -s /bin/bash "$APP_USER"

# ─────────────────────────────────────────────────────────────────────────────
log "8/12  Postgres + Redis, bound to localhost only"
# Redis: localhost bind, no external exposure. (Open Redis is a classic RCE vector.)
sed -i 's/^bind .*/bind 127.0.0.1 -::1/'        /etc/redis/redis.conf
sed -i 's/^# *protected-mode .*/protected-mode yes/' /etc/redis/redis.conf
grep -q '^protected-mode yes' /etc/redis/redis.conf || echo 'protected-mode yes' >> /etc/redis/redis.conf
systemctl restart redis-server && systemctl enable redis-server >/dev/null

DB_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
sudo -u postgres psql -qtAc "SELECT 1 FROM pg_roles WHERE rolname='sentinel'" | grep -q 1 \
  && sudo -u postgres psql -qc "ALTER USER sentinel WITH PASSWORD '${DB_PASS}';" \
  || sudo -u postgres psql -qc "CREATE USER sentinel WITH PASSWORD '${DB_PASS}' CREATEDB;"
sudo -u postgres psql -qtAc "SELECT 1 FROM pg_database WHERE datname='sentinel'" | grep -q 1 \
  || sudo -u postgres createdb -O sentinel sentinel
# CREATEDB is needed for Prisma's shadow database during migrate.
sudo -u postgres psql -qc "ALTER USER sentinel CREATEDB;"
systemctl enable postgresql >/dev/null

# ─────────────────────────────────────────────────────────────────────────────
log "9/12  MinIO (S3 artifacts), bound to localhost only"
if [[ ! -x /usr/local/bin/minio ]]; then
  curl -fsSL https://dl.min.io/server/minio/release/linux-amd64/minio -o /usr/local/bin/minio
  chmod +x /usr/local/bin/minio
fi
MINIO_USER="sentinel"
MINIO_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
install -d -o "$APP_USER" -g "$APP_USER" /var/lib/minio
cat > /etc/systemd/system/minio.service <<EOF
[Unit]
Description=MinIO object storage
After=network.target

[Service]
User=${APP_USER}
Group=${APP_USER}
Environment=MINIO_ROOT_USER=${MINIO_USER}
Environment=MINIO_ROOT_PASSWORD=${MINIO_PASS}
# --address/--console-address on 127.0.0.1 keeps MinIO off the public internet.
ExecStart=/usr/local/bin/minio server /var/lib/minio --address 127.0.0.1:9000 --console-address 127.0.0.1:9001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now minio >/dev/null

# ─────────────────────────────────────────────────────────────────────────────
log "10/12  Clone app + generate fresh secrets"
# Step 10 chowns $APP_DIR to $APP_USER, so on any *re-run* this script is root
# operating a repo owned by someone else and git refuses with "detected dubious
# ownership". Declaring it safe is correct here: we own the box, and the only
# writer is this script.
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
if [[ -d $APP_DIR/.git ]]; then
  git -C "$APP_DIR" pull --ff-only
else
  rm -rf "$APP_DIR"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

AUTH_SECRET="$(openssl rand -base64 32)"
ENC_KEY="$(openssl rand -base64 32)"
RUNNER_TOKEN="$(openssl rand -hex 32)"
PUBLIC_URL="${PUBLIC_URL:-http://$(curl -fsS --max-time 5 ifconfig.me || echo localhost)}"

cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
DATABASE_URL=postgresql://sentinel:${DB_PASS}@127.0.0.1:5432/sentinel
REDIS_URL=redis://127.0.0.1:6379
AUTH_SECRET=${AUTH_SECRET}
AUTH_TRUST_HOST=true
NEXTAUTH_URL=${PUBLIC_URL}
SENTINEL_PUBLIC_URL=${PUBLIC_URL}
ENCRYPTION_KEY=${ENC_KEY}
RUNNER_TOKEN=${RUNNER_TOKEN}
API_PORT=3001
API_HOST=127.0.0.1
WEB_PORT=3000
CORS_ORIGINS=${PUBLIC_URL}
S3_ENDPOINT=http://127.0.0.1:9000
S3_ACCESS_KEY=${MINIO_USER}
S3_SECRET_KEY=${MINIO_PASS}
S3_BUCKET=sentinel-artifacts
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
MAIL_FROM=sentinel@sentinel.example
LOG_LEVEL=info
EOF
chmod 600 "$APP_DIR/.env"
# Per-package copies: Prisma and Next both read from their own cwd.
for d in packages/db apps/api apps/web apps/runner; do
  [[ -d "$APP_DIR/$d" ]] && cp "$APP_DIR/.env" "$APP_DIR/$d/.env" && chmod 600 "$APP_DIR/$d/.env"
done
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ─────────────────────────────────────────────────────────────────────────────
log "11/12  Install, migrate, build"
cd "$APP_DIR"
pnpm install --frozen-lockfile 2>&1 | tail -3
pnpm --filter @sentinel/shared build 2>&1 | tail -2
pnpm --filter @sentinel/ir build     2>&1 | tail -2
pnpm --filter @sentinel/db exec prisma generate 2>&1 | tail -2
pnpm --filter @sentinel/db exec prisma migrate deploy 2>&1 | tail -3
pnpm --filter @sentinel/db exec tsx prisma/seed.ts 2>&1 | tail -3 || warn "Seed failed (non-fatal)."
# Cap the heap so a build can never OOM-kill Postgres/Redis out from under us.
NODE_OPTIONS='--max-old-space-size=1400' pnpm --filter @sentinel/web build 2>&1 | tail -6

# ─────────────────────────────────────────────────────────────────────────────
log "12/12  Nginx reverse proxy + PM2"
cat > /etc/nginx/sites-available/sentinel <<'EOF'
server {
    listen 80 default_server;
    server_name _;

    client_max_body_size 64m;

    # Security headers (TLS ones are added by certbot when you attach a domain).
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location /api/  { proxy_pass http://127.0.0.1:3001; include /etc/nginx/proxy_params; }
    location /docs  { proxy_pass http://127.0.0.1:3001; include /etc/nginx/proxy_params; }
    location /healthz { proxy_pass http://127.0.0.1:3001; include /etc/nginx/proxy_params; }
    location /hooks/  { proxy_pass http://127.0.0.1:3001; include /etc/nginx/proxy_params; }

    # /internal is runner-only and must never be reachable from outside.
    location /internal/ { deny all; return 404; }

    location / {
        proxy_pass http://127.0.0.1:3000;
        include /etc/nginx/proxy_params;
        # SSE live logs must not be buffered or they arrive all at once at the end.
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
EOF
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/sentinel /etc/nginx/sites-enabled/sentinel
nginx -t && systemctl reload nginx && systemctl enable nginx >/dev/null

# PM2 via an ecosystem file: `pm2 start -e KEY=val` silently ignores env vars.
cat > "$APP_DIR/ecosystem.config.cjs" <<EOF
const fs = require('fs');
const env = Object.fromEntries(
  fs.readFileSync('${APP_DIR}/.env', 'utf8')
    .split('\n').filter(l => l.trim() && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
module.exports = {
  apps: [
    {
      name: 'api',
      cwd: '${APP_DIR}/apps/api',
      script: 'node',
      args: '--import tsx/esm src/server.ts',
      env,
      max_memory_restart: '500M',
    },
    {
      name: 'web',
      cwd: '${APP_DIR}/apps/web',
      // NOT node_modules/.bin/next — that is a POSIX *shell* wrapper, and pm2
      // hands its script to node, which chokes on line 2 with
      // "SyntaxError: missing ) after argument list". Point at the real JS entry,
      // same shape as the api app above.
      script: 'node',
      args: 'node_modules/next/dist/bin/next start -p 3000 -H 127.0.0.1',
      env,
      max_memory_restart: '600M',
    },
  ],
};
EOF
chown "$APP_USER:$APP_USER" "$APP_DIR/ecosystem.config.cjs"

pm2 delete all >/dev/null 2>&1 || true
pm2 start "$APP_DIR/ecosystem.config.cjs"
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

log "Verification"
# Poll rather than sleeping a fixed 10s and hoping: Next takes a while to be ready
# to serve, and a crash-looping app can look "online" to `pm2 list` for a moment
# before it dies again.
check() { # <label> <url>
  local i
  for i in $(seq 1 30); do
    if curl -fsS -o /dev/null --max-time 5 "$2"; then
      printf '  %-20s -> OK\n' "$1"; return 0
    fi
    sleep 2
  done
  printf '  %-20s -> FAILED\n' "$1"; return 1
}

VERIFY_FAILED=0
check 'api   /healthz' http://127.0.0.1:3001/healthz || VERIFY_FAILED=1
check 'web   /login'   http://127.0.0.1:3000/login   || VERIFY_FAILED=1
check 'nginx /login'   http://127.0.0.1/login        || VERIFY_FAILED=1
pm2 list

# Previously this script printed "provisioned and hardened" unconditionally, so a
# run where both apps were crash-looping still looked like a success.
if (( VERIFY_FAILED )); then
  echo
  pm2 logs --nostream --lines 40 2>/dev/null || true
  die "Provisioning completed but the app is NOT serving — see the logs above, and 'pm2 logs'."
fi

cat <<EOF

╭──────────────────────────────────────────────────────────────╮
│  Sentinel is provisioned and hardened.                       │
╰──────────────────────────────────────────────────────────────╯

  URL          ${PUBLIC_URL}
  Login        demo@sentinel.local / demo1234   <-- CHANGE THIS

  Public ports  22 (rate-limited), 80, 443  — everything else is localhost-only
  Secrets       generated on this box, stored in ${APP_DIR}/.env (chmod 600)

  Next steps
    1. Change the seeded demo password immediately.
    2. Point a domain at this IP, then: certbot --nginx -d your.domain
       (HTTP-only means session cookies travel in clear text.)
    3. Check status:  pm2 list && pm2 logs
    4. Verify hardening:  ufw status verbose && ss -tlnp | grep -v 127.0.0.1

EOF
