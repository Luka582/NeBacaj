#!/usr/bin/env bash
#
# NeBacaj runner: sets up and runs the app in development or production.
#
# Usage:
#   ./run.sh            interactive menu
#   ./run.sh dev        development: uvicorn --reload + vite, both behind nginx
#   ./run.sh prod       production: built frontend + systemd backend + cloudflared
#   ./run.sh stop       stop production (backend, cloudflared, nginx site)
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="$(id -un)"
DB_FILE="$REPO_DIR/nebacaj.db"
ENV_FILE="$REPO_DIR/.env"
FRONTEND_DIR="$REPO_DIR/frontend"
WEB_ROOT="/var/www/nebacaj"

NGINX_SITE="nebacaj"
NGINX_AVAILABLE="/etc/nginx/sites-available/$NGINX_SITE"
NGINX_ENABLED="/etc/nginx/sites-enabled/$NGINX_SITE"
BACKEND_SERVICE="nebacaj-backend"
BACKEND_UNIT="/etc/systemd/system/$BACKEND_SERVICE.service"
CLOUDFLARED_SERVICE="cloudflared"
CLOUDFLARED_UNIT="/etc/systemd/system/$CLOUDFLARED_SERVICE.service"
CLOUDFLARED_TOKEN_FILE="/etc/cloudflared/token"

BACKEND_PORT=8000
VITE_PORT=5173

UVICORN_PID=""
VITE_PID=""

DEV_PATTERNS=(
  "uvicorn backend.app:app .*--reload"
  "vite --host 127.0.0.1 --port $VITE_PORT"
)

if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BLUE=$'\033[1;34m'; C_YEL=$'\033[1;33m'; C_RED=$'\033[1;31m'
else
  C_RESET=""; C_BLUE=""; C_YEL=""; C_RED=""
fi
log()  { printf '%s==>%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
warn() { printf '%s!!!%s %s\n' "$C_YEL" "$C_RESET" "$*" >&2; }
die()  { printf '%sERR%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif have sudo; then
  SUDO="sudo"
else
  die "This script needs root privileges (run as root or install sudo)."
fi

ask() {
  local __prompt="$1" __var="$2"
  read -r -p "$__prompt" "$__var" < /dev/tty || die "No input available."
}

ask_secret() {
  local __prompt="$1" __var="$2"
  read -rs -p "$__prompt" "$__var" < /dev/tty || die "No input available."
  printf '\n'
}

confirm() {
  local answer
  read -r -p "$1 [y/N] " answer < /dev/tty || return 1
  [[ "$answer" =~ ^[Yy] ]]
}

choose_mode() {
  printf '\nNeBacaj runner\n' >&2
  printf '  1) Development\n' >&2
  printf '  2) Production\n' >&2
  printf '  3) Stop production\n\n' >&2
  local choice
  ask "Select [1-3]: " choice
  case "$choice" in
    1|dev|development) echo dev ;;
    2|prod|production) echo prod ;;
    3|stop)            echo stop ;;
    *) die "Invalid selection: $choice" ;;
  esac
}

# --- dependencies -----------------------------------------------------------

ensure_packages() {
  local pkgs=()
  have nginx || pkgs+=(nginx)
  if ! have node && ! have nodejs; then pkgs+=(nodejs); fi
  have npm  || pkgs+=(npm)
  have curl || pkgs+=(curl)
  if [ "${#pkgs[@]}" -gt 0 ]; then
    log "Installing system packages: ${pkgs[*]}"
    $SUDO apt-get update || warn "apt-get update reported errors (e.g. an unsigned third-party repo); continuing."
    $SUDO apt-get install -y "${pkgs[@]}"
  fi
}

ensure_uv() {
  have uv && return 0
  log "Installing uv..."
  have curl || die "curl is required to install uv."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
  have uv || die "uv installation failed."
}

sync_python_deps() {
  log "Syncing Python dependencies (uv sync)..."
  ( cd "$REPO_DIR" && uv sync )
}

ensure_node_modules() {
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    log "Installing frontend dependencies (npm ci)..."
    ( cd "$FRONTEND_DIR" && npm ci )
  fi
}

ensure_cloudflared() {
  have cloudflared && return 0
  log "Installing cloudflared..."
  $SUDO mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    | $SUDO tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    | $SUDO tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
  $SUDO apt-get update || warn "apt-get update reported errors; continuing."
  $SUDO apt-get install -y cloudflared
}

# --- environment / data -----------------------------------------------------

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$REPO_DIR/.env.example" ]; then
      warn ".env not found, generating it from .env.example."
      cp "$REPO_DIR/.env.example" "$ENV_FILE"
      die "Edit $ENV_FILE (set JWT_SECRET and ADMIN_EMAIL) and re-run."
    fi
    die ".env not found."
  fi
  grep -qE '^[[:space:]]*JWT_SECRET[[:space:]]*=[[:space:]]*"?[^"[:space:]]' "$ENV_FILE" \
    || die "JWT_SECRET is not set in $ENV_FILE."
}

admin_email_set() {
  grep -qE '^[[:space:]]*ADMIN_EMAIL[[:space:]]*=[[:space:]]*"?[^"[:space:]]' "$ENV_FILE"
}

# Read a single KEY=value from .env (trimmed, surrounding quotes stripped).
env_value() {
  local key="$1" line
  [ -f "$ENV_FILE" ] || return 0
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" | tail -n1)" || return 0
  [ -n "$line" ] || return 0
  line="${line#*=}"
  line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  case "$line" in
    \"*\") line="${line#\"}"; line="${line%\"}" ;;
    \'*\') line="${line#\'}"; line="${line%\'}" ;;
  esac
  printf '%s' "$line"
}

bootstrap_db() {
  local mode="$1"
  if [ ! -f "$DB_FILE" ]; then
    if [ "$mode" = "dev" ]; then
      log "Database missing, creating dummy data..."
      ( cd "$REPO_DIR" && uv run python -m backend.make_dummy_data )
    fi
    if admin_email_set; then
      log "Creating the admin account..."
      ( cd "$REPO_DIR" && uv run python -m backend.seed_admin )
    else
      warn "ADMIN_EMAIL is not set in .env, skipping admin creation."
    fi
  else
    log "Database already exists, leaving it untouched."
  fi
}

# --- nginx ------------------------------------------------------------------

nginx_reload() {
  $SUDO systemctl enable --now nginx >/dev/null 2>&1 || true
  $SUDO nginx -t
  $SUDO systemctl reload nginx
}

enable_site() {
  $SUDO rm -f /etc/nginx/sites-enabled/default
  $SUDO ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"
  nginx_reload
}

write_dev_site() {
  $SUDO tee "$NGINX_AVAILABLE" >/dev/null <<'EOF'
server {
    listen 80 default_server;
    server_name _;

    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
EOF
  enable_site
}

write_prod_site() {
  $SUDO tee "$NGINX_AVAILABLE" >/dev/null <<'EOF'
server {
    listen 127.0.0.1:80 default_server;
    server_name _;

    root __ROOT__;

    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri /index.html;
    }
}
EOF
  $SUDO sed -i "s|__ROOT__|$WEB_ROOT|" "$NGINX_AVAILABLE"
  enable_site
}

# The repo usually lives in the user's home, which nginx (www-data) cannot
# traverse, so copy the build to a world-readable location.
deploy_frontend() {
  log "Deploying the build to $WEB_ROOT..."
  $SUDO rm -rf "$WEB_ROOT"
  $SUDO mkdir -p "$WEB_ROOT"
  $SUDO cp -a "$FRONTEND_DIR/dist/." "$WEB_ROOT/"
  $SUDO chown -R root:root "$WEB_ROOT"
  $SUDO chmod -R a+rX "$WEB_ROOT"
}

# --- helpers ----------------------------------------------------------------

lan_ip() {
  hostname -I 2>/dev/null | tr ' ' '\n' | grep -m1 -E '^(10|172|192)\.' || true
}

wait_port() {
  local port="$1" tries="${2:-50}" i
  for ((i = 0; i < tries; i++)); do
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

compute_workers() {
  local override cpus workers
  override="${UVICORN_WORKERS:-}"
  [ -n "$override" ] || override="$(env_value UVICORN_WORKERS)"
  if [[ "$override" =~ ^[1-9][0-9]*$ ]]; then
    echo "$override"
    return
  fi
  if [ -n "$override" ]; then
    warn "UVICORN_WORKERS='$override' is not a positive integer; auto-detecting."
  fi
  cpus="$(nproc 2>/dev/null || echo 1)"
  if [ "$cpus" -gt 4 ]; then
    workers=4
  else
    workers="$cpus"
  fi
  [ "$workers" -lt 1 ] && workers=1
  echo "$workers"
}

prod_active() {
  systemctl is-active --quiet "$BACKEND_SERVICE" 2>/dev/null \
    || systemctl is-active --quiet "$CLOUDFLARED_SERVICE" 2>/dev/null
}

kill_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
}

dev_running() {
  local pattern
  for pattern in "${DEV_PATTERNS[@]}"; do
    pgrep -f -- "$pattern" >/dev/null 2>&1 && return 0
  done
  return 1
}

terminate_dev() {
  local pattern pids i
  for pattern in "${DEV_PATTERNS[@]}"; do
    pids="$(pgrep -f -- "$pattern" 2>/dev/null || true)"
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
  for ((i = 0; i < 25; i++)); do
    dev_running || break
    sleep 0.2
  done
  sleep 2
  dev_running && warn "Some development processes are still running."
  return 0
}

verify_prod() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/ 2>/dev/null || true)"
  log "Frontend via nginx: HTTP ${code:-no-response}"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/api/towns 2>/dev/null || true)"
  log "Backend via nginx:  HTTP ${code:-no-response}"
}

# --- development ------------------------------------------------------------

cleanup_dev() {
  trap - INT TERM EXIT
  log "Shutting down development..."
  kill_tree "$VITE_PID"
  kill_tree "$UVICORN_PID"
  # also kill any leftover dev processes
  terminate_dev 2>/dev/null || true
  wait 2>/dev/null || true
  if [ -L "$NGINX_ENABLED" ] || [ -f "$NGINX_ENABLED" ]; then
    $SUDO rm -f "$NGINX_ENABLED"
    $SUDO systemctl reload nginx 2>/dev/null || true
  fi
  log "Stopped."
  # restore terminal
  stty sane 2>/dev/null || true
  tput cnorm 2>/dev/null || true
}

on_signal() { cleanup_dev; exit 0; }

start_dev() {
  ensure_packages
  ensure_uv
  ensure_env
  sync_python_deps
  ensure_node_modules

  if prod_active; then
    warn "Production is currently running."
    confirm "Stop it before starting development?" || die "Aborted."
    stop_prod
  fi

  bootstrap_db dev

  trap on_signal INT TERM
  trap cleanup_dev EXIT

  log "Starting backend (uvicorn --reload on 127.0.0.1:$BACKEND_PORT)..."
  ( exec setsid "$(command -v uv)" run uvicorn backend.app:app \
      --host 127.0.0.1 --port "$BACKEND_PORT" --reload ) &
  UVICORN_PID=$!

  log "Starting frontend dev server (vite on 127.0.0.1:$VITE_PORT)..."
  ( cd "$FRONTEND_DIR" && exec setsid npm run dev -- --host 127.0.0.1 --port "$VITE_PORT" --strictPort ) &
  VITE_PID=$!

  log "Configuring nginx..."
  write_dev_site

  wait_port "$BACKEND_PORT" 75 || warn "Backend has not opened port $BACKEND_PORT yet."
  wait_port "$VITE_PORT" 75    || warn "Vite has not opened port $VITE_PORT yet."

  local ip
  ip="$(lan_ip)"
  printf '\n'
  log "Development is up:"
  printf '    http://localhost/\n'
  [ -n "$ip" ] && printf '    http://%s/  (LAN)\n' "$ip"
  printf '\nPress Ctrl+C to stop.\n\n'

  wait
}

# --- production -------------------------------------------------------------

write_backend_unit() {
  local workers uv
  workers="$(compute_workers)"
  uv="$(command -v uv)"
  log "Writing systemd unit ($BACKEND_SERVICE, $workers worker(s))..."
  $SUDO tee "$BACKEND_UNIT" >/dev/null <<EOF
[Unit]
Description=NeBacaj backend (FastAPI/uvicorn)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$REPO_DIR
Environment=HOME=$HOME
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=UV_NO_PROGRESS=1
Environment=DOCS_ENABLED=0
ExecStart=$uv run uvicorn backend.app:app --host 127.0.0.1 --port $BACKEND_PORT --workers $workers --proxy-headers --forwarded-allow-ips 127.0.0.1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable "$BACKEND_SERVICE" >/dev/null 2>&1 || true
}

start_prod() {
  ensure_packages
  ensure_uv
  ensure_env
  sync_python_deps
  ensure_node_modules
  ensure_cloudflared

  if dev_running; then
    warn "A development instance is running (uvicorn --reload / vite); it holds port $BACKEND_PORT."
    confirm "Stop it and continue with production?" || die "Aborted."
    terminate_dev
  fi

  bootstrap_db prod

  if prod_active; then
    warn "Production services are already running."
    confirm "Reconfigure and restart them?" || die "Aborted."
  fi

  log "Building the frontend..."
  ( cd "$FRONTEND_DIR" && npm run build )
  deploy_frontend

  log "Configuring nginx (production site on 127.0.0.1:80)..."
  write_prod_site

  write_backend_unit
  $SUDO systemctl restart "$BACKEND_SERVICE"

  local token="${CLOUDFLARE_TUNNEL_TOKEN:-$(env_value CLOUDFLARE_TUNNEL_TOKEN)}"
  if [ -f "$CLOUDFLARED_UNIT" ]; then
    if [ -n "$token" ]; then
      log "Syncing the Cloudflare tunnel token from .env..."
      $SUDO mkdir -p "$(dirname "$CLOUDFLARED_TOKEN_FILE")"
      printf '%s' "$token" | $SUDO tee "$CLOUDFLARED_TOKEN_FILE" >/dev/null
      $SUDO chmod 600 "$CLOUDFLARED_TOKEN_FILE"
    else
      log "cloudflared service already installed; reusing it."
      log "  (no CLOUDFLARE_TUNNEL_TOKEN found; keeping the existing token file)"
    fi
  else
    if [ -z "$token" ]; then
      ask_secret "Cloudflare tunnel token: " token
    fi
    [ -n "$token" ] || die "A Cloudflare tunnel token is required to install the service."
    log "Installing the cloudflared service..."
    $SUDO cloudflared service install "$token"
  fi
  $SUDO systemctl enable --now "$CLOUDFLARED_SERVICE" >/dev/null 2>&1 || true
  $SUDO systemctl restart "$CLOUDFLARED_SERVICE" 2>/dev/null \
    || warn "cloudflared service is not running (no token / no existing config?)."

  printf '\n'
  log "Production is up. Service status:"
  $SUDO systemctl --no-pager --lines=0 status "$BACKEND_SERVICE" 2>/dev/null || true
  $SUDO systemctl --no-pager --lines=0 status "$CLOUDFLARED_SERVICE" 2>/dev/null || true
  printf '\n'
  verify_prod
  printf '\n'
  log "Nginx listens on 127.0.0.1:80, exposed through the Cloudflare tunnel."
  log "Make sure the tunnel routes nebacaj.com and www.nebacaj.com to http://localhost:80."
}

# --- stop -------------------------------------------------------------------

stop_prod() {
  log "Stopping production..."
  $SUDO systemctl stop "$BACKEND_SERVICE" 2>/dev/null || true
  $SUDO systemctl stop "$CLOUDFLARED_SERVICE" 2>/dev/null || true

  if [ -L "$NGINX_ENABLED" ] || [ -f "$NGINX_ENABLED" ]; then
    $SUDO rm -f "$NGINX_ENABLED"
    $SUDO systemctl reload nginx 2>/dev/null || true
  fi

  if confirm "Disable start-on-boot for $BACKEND_SERVICE and $CLOUDFLARED_SERVICE?"; then
    $SUDO systemctl disable "$BACKEND_SERVICE" 2>/dev/null || true
    $SUDO systemctl disable "$CLOUDFLARED_SERVICE" 2>/dev/null || true
  fi
  log "Production stopped."
}

# --- main -------------------------------------------------------------------

usage() {
  cat <<'EOF'
NeBacaj runner

Usage:
  ./run.sh            interactive menu
  ./run.sh dev        development: uvicorn --reload + vite, both behind nginx
  ./run.sh prod       production: built frontend + systemd backend + cloudflared
  ./run.sh stop       stop production (backend, cloudflared, nginx site)
EOF
}

main() {
  cd "$REPO_DIR"
  local mode="${1:-}"
  case "$mode" in
    -h|--help|help) usage; exit 0 ;;
    "") mode="$(choose_mode)" ;;
  esac
  case "$mode" in
    dev|development) start_dev ;;
    prod|production) start_prod ;;
    stop)            stop_prod ;;
    *) die "Usage: $0 [dev|prod|stop]" ;;
  esac
}

main "$@"
