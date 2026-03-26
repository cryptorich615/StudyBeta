#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/.run"
OPENCLAW_HEALTH_URL="${OPENCLAW_HEALTH_URL:-http://127.0.0.1:18789/health}"
API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-3000}"
CHECK_INTERVAL="${CHECK_INTERVAL:-5}"
PNPM_BIN="${PNPM_BIN:-/home/ubuntu/.nvm/versions/node/v24.14.0/bin/pnpm}"
NEXT_BIN="${NEXT_BIN:-/home/ubuntu/StudyBeta/studyclaw/node_modules/.bin/next}"

mkdir -p "$LOG_DIR"

api_pid=""
web_pid=""

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
  curl -fsS "$OPENCLAW_HEALTH_URL" >/dev/null 2>&1
}

start_api() {
  if is_pid_running "$api_pid"; then
    return
  fi

  local port_owner
  port_owner="$(port_pid "$API_PORT")"
  if [[ -n "$port_owner" ]]; then
    api_pid="$port_owner"
    log "API already listening on :$API_PORT with pid $api_pid"
    return
  fi

  log "Starting StudyClaw API on :$API_PORT"
  (
    cd "$ROOT_DIR"
    exec "$PNPM_BIN" dev:api >>"$LOG_DIR/api.log" 2>&1
  ) &
  api_pid="$!"
  echo "$api_pid" >"$LOG_DIR/api.pid"
}

start_web() {
  if is_pid_running "$web_pid"; then
    return
  fi

  local port_owner
  port_owner="$(port_pid "$WEB_PORT")"
  if [[ -n "$port_owner" ]]; then
    web_pid="$port_owner"
    log "Web already listening on :$WEB_PORT with pid $web_pid"
    return
  fi

  log "Starting StudyClaw web on :$WEB_PORT"
  (
    cd "$ROOT_DIR/apps/web"
    exec "$NEXT_BIN" start -p "$WEB_PORT" >>"$LOG_DIR/web.log" 2>&1
  ) &
  web_pid="$!"
  echo "$web_pid" >"$LOG_DIR/web.pid"
}

stop_pid() {
  local pid="${1:-}"
  local label="$2"

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
  stop_pid "$web_pid" "StudyClaw web"
  stop_pid "$api_pid" "StudyClaw API"
  web_pid=""
  api_pid=""
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
    fi

    if [[ -n "$web_pid" ]] && ! is_pid_running "$web_pid"; then
      log "Web exited; restarting"
      web_pid=""
    fi
  else
    log "OpenClaw is unavailable; StudyClaw services will remain stopped until it returns"
    stop_children
  fi

  sleep "$CHECK_INTERVAL"
done
