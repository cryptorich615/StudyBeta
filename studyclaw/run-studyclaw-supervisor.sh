#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/.run"
OPENCLAW_HEALTH_URL="${OPENCLAW_HEALTH_URL:-http://127.0.0.1:18789/health}"
API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-3000}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:${API_PORT}/api/health}"
WEB_HEALTH_URL="${WEB_HEALTH_URL:-http://127.0.0.1:${WEB_PORT}/dashboard}"
CHECK_INTERVAL="${CHECK_INTERVAL:-5}"
PNPM_BIN="${PNPM_BIN:-$(command -v pnpm || true)}"
PNPM_FALLBACK_BIN="/home/ubuntu/.nvm/versions/node/v24.14.0/bin/pnpm"
NEXT_BIN="${NEXT_BIN:-$ROOT_DIR/node_modules/.bin/next}"
TSX_BIN="${TSX_BIN:-$ROOT_DIR/node_modules/.bin/tsx}"
LOCK_FILE="$LOG_DIR/supervisor.lock"

mkdir -p "$LOG_DIR"

api_pid=""
web_pid=""
api_managed="0"
web_managed="0"

if [[ -z "$PNPM_BIN" && -x "$PNPM_FALLBACK_BIN" ]]; then
  PNPM_BIN="$PNPM_FALLBACK_BIN"
fi

if [[ -z "$PNPM_BIN" ]]; then
  printf 'Unable to locate pnpm. Set PNPM_BIN before starting StudyClaw.\n' >&2
  exit 1
fi

if [[ ! -x "$NEXT_BIN" ]]; then
  printf 'Unable to locate next. Set NEXT_BIN before starting StudyClaw.\n' >&2
  exit 1
fi

if [[ ! -x "$TSX_BIN" ]]; then
  printf 'Unable to locate tsx. Set TSX_BIN before starting StudyClaw.\n' >&2
  exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  printf 'Another StudyClaw supervisor instance is already running.\n' >&2
  exit 1
fi

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

log() {
  printf '[%s] %s\n' "$(timestamp)" "$*" | tee -a "$LOG_DIR/supervisor.log"
}

port_pid() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

is_pid_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

openclaw_is_healthy() {
  if curl -fsS "$OPENCLAW_HEALTH_URL" >/dev/null 2>&1; then
    return 0
  fi

  local listener
  listener="$(lsof -iTCP:18789 -sTCP:LISTEN -P -n 2>/dev/null | awk 'NR==2 {print $9}' | sed 's/ (LISTEN)$//')"
  if [[ -z "$listener" ]]; then
    return 1
  fi

  curl -fsS "http://$listener/health" >/dev/null 2>&1
}

api_is_healthy() {
  curl -fsS "$API_HEALTH_URL" >/dev/null 2>&1
}

web_is_healthy() {
  curl -fsS "$WEB_HEALTH_URL" >/dev/null 2>&1
}

build_web() {
  log "Building StudyClaw web"
  (
    cd "$ROOT_DIR/apps/web"
    rm -rf .next
    exec "$NEXT_BIN" build >>"$LOG_DIR/web-build.log" 2>&1
  )
}

start_api() {
  if is_pid_running "$api_pid"; then
    return
  fi

  if api_is_healthy; then
    api_pid="$(port_pid "$API_PORT")"
    api_managed="0"
    log "API already listening on :$API_PORT with pid $api_pid"
    return
  fi

  log "Starting StudyClaw API on :$API_PORT"
  (
    cd "$ROOT_DIR"
    exec "$TSX_BIN" "$ROOT_DIR/apps/api/src/main.ts" >>"$LOG_DIR/api.log" 2>&1
  ) &
  api_pid="$!"
  api_managed="1"
  echo "$api_pid" >"$LOG_DIR/api.pid"
}

start_web() {
  if is_pid_running "$web_pid"; then
    return
  fi

  if web_is_healthy; then
    web_pid="$(port_pid "$WEB_PORT")"
    web_managed="0"
    log "Web already listening on :$WEB_PORT with pid $web_pid"
    return
  fi

  if ! build_web; then
    log "Web build failed; will retry on the next loop"
    web_pid=""
    web_managed="0"
    return
  fi

  log "Starting StudyClaw web on :$WEB_PORT"
  (
    cd "$ROOT_DIR/apps/web"
    exec "$NEXT_BIN" start -p "$WEB_PORT" >>"$LOG_DIR/web.log" 2>&1
  ) &
  web_pid="$!"
  web_managed="1"
  echo "$web_pid" >"$LOG_DIR/web.pid"
}

stop_pid() {
  local pid="${1:-}"
  local label="$2"
  local managed="${3:-0}"

  if [[ "$managed" != "1" ]]; then
    return
  fi

  if ! is_pid_running "$pid"; then
    return
  fi

  log "Stopping $label pid $pid"
  kill "$pid" 2>/dev/null || true
  sleep 1
  if is_pid_running "$pid"; then
    kill -9 "$pid" 2>/dev/null || true
  fi
}

stop_children() {
  stop_pid "$web_pid" "StudyClaw web" "$web_managed"
  stop_pid "$api_pid" "StudyClaw API" "$api_managed"
  web_pid=""
  api_pid=""
  web_managed="0"
  api_managed="0"
  rm -f "$LOG_DIR/web.pid" "$LOG_DIR/api.pid"
}

cleanup() {
  log "Supervisor shutting down"
  stop_children
  rm -f "$LOG_DIR/supervisor.pid"
}

trap cleanup EXIT INT TERM

echo "$$" >"$LOG_DIR/supervisor.pid"
log "Supervisor started"

while true; do
  if openclaw_is_healthy; then
    start_api
    start_web

    if [[ -n "$api_pid" ]] && ! is_pid_running "$api_pid"; then
      log "API exited; restarting"
      api_pid=""
      api_managed="0"
    fi

    if [[ -n "$web_pid" ]] && ! is_pid_running "$web_pid"; then
      log "Web exited; restarting"
      web_pid=""
      web_managed="0"
    fi
  else
    log "OpenClaw is unavailable; StudyClaw services will remain stopped until it returns"
    stop_children
  fi

  sleep "$CHECK_INTERVAL"
done
