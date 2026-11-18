#!/usr/bin/env bash
# discord-rpc.sh - presence bridge only.
#
# Starts ONLY the Century relay (port 3005) with the Discord Rich
# Presence bridge, without Navidrome and without the deck. For a user
# who does not want the full run.sh stack: start Discord, run this
# script, open Photon, play a song.
#
# The client ID (Discord Application ID, 18 digits) resolves in this
# order: --client-id argument, DISCORD_CLIENT_ID env var, relay/.env.
# The value is never printed; only whether it is set and where it came
# from. Use this script OR run.sh, never both: both start the relay on
# port 3005, and this script refuses to start when the port is busy.
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

RELAY_PORT="${RELAY_PORT:-3005}"
LOG_DIR="$PROJECT_DIR/.runner-logs"
RELAY_LOG="$LOG_DIR/discord-rpc.log"

mkdir -p "$LOG_DIR"

log() {
    printf '%s\n' "$*"
}

fail() {
    printf '\nERROR: %s\n' "$*" >&2
    exit 1
}

CLIENT_ID_ARG=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --client-id)
            [[ $# -ge 2 ]] || fail "--client-id needs a value (the 18-digit Discord Application ID)."
            CLIENT_ID_ARG="$2"
            shift 2
            ;;
        --client-id=*)
            CLIENT_ID_ARG="${1#--client-id=}"
            shift
            ;;
        --help | -h)
            log "Usage: $0 [--client-id <18-digit Discord Application ID>]"
            log ""
            log "Starts only the relay (port 3005) with the Discord Rich Presence bridge."
            log "The client ID can also come from DISCORD_CLIENT_ID or relay/.env."
            exit 0
            ;;
        *)
            fail "Unknown argument: $1 (see --help)."
            ;;
    esac
done

command -v bun >/dev/null 2>&1 ||
    fail "bun not found on PATH. Install Bun (https://bun.sh) and retry."
command -v curl >/dev/null 2>&1 ||
    fail "curl not found on PATH."
command -v ss >/dev/null 2>&1 ||
    fail "ss not found on PATH."

# Resolve the client ID. The value is never printed.
CLIENT_ID_SOURCE=""
if [[ -n "$CLIENT_ID_ARG" ]]; then
    [[ "$CLIENT_ID_ARG" =~ ^[0-9]{1,19}$ ]] ||
        fail "--client-id must be a numeric Discord Application ID (digits only)."
    export DISCORD_CLIENT_ID="$CLIENT_ID_ARG"
    CLIENT_ID_SOURCE="--client-id argument"
elif [[ -n "${DISCORD_CLIENT_ID:-}" ]]; then
    [[ "$DISCORD_CLIENT_ID" =~ ^[0-9]{1,19}$ ]] ||
        fail "DISCORD_CLIENT_ID must be a numeric Discord Application ID (digits only)."
    CLIENT_ID_SOURCE="DISCORD_CLIENT_ID environment variable"
elif [[ -f "$PROJECT_DIR/relay/.env" ]] &&
    grep -q '^DISCORD_CLIENT_ID=[0-9]\{1,19\}' "$PROJECT_DIR/relay/.env"; then
    CLIENT_ID_SOURCE="relay/.env"
fi

[[ -n "$CLIENT_ID_SOURCE" ]] ||
    fail "No Discord client ID found. Create an application at https://discord.com/developers/applications and pass its Application ID via --client-id, DISCORD_CLIENT_ID, or relay/.env."

if ss -H -ltn "sport = :${RELAY_PORT}" 2>/dev/null | grep -q .; then
    fail "Port $RELAY_PORT is already in use: the relay is already running. Use that one instead (one launcher or the other, never both)."
fi

if [[ ! -d "$PROJECT_DIR/relay/node_modules/@xhayper/discord-rpc" ]]; then
    log "Installing relay dependencies (bun install)..."
    (cd "$PROJECT_DIR/relay" && bun install) || fail "bun install failed for the relay"
fi

log "========================================================"
log "  Photon: Discord Rich Presence bridge only"
log "========================================================"
log ""
log "Discord client ID: configured (from $CLIENT_ID_SOURCE)."
log "Relay log: $RELAY_LOG"
log ""

RELAY_PID=""

cleanup() {
    local status=$?
    trap - EXIT INT TERM
    if [[ -n "$RELAY_PID" ]] && kill -0 "$RELAY_PID" 2>/dev/null; then
        log ""
        log "Clearing Discord presence..."
        curl -sS -X POST --max-time 2 "http://127.0.0.1:${RELAY_PORT}/api/presence/clear" >/dev/null 2>&1 || true
        kill -TERM "$RELAY_PID" 2>/dev/null || true
        wait "$RELAY_PID" 2>/dev/null || true
    fi
    log "Shutdown complete."
    exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

log "Starting relay (presence bridge only, no Navidrome, no deck)..."
# Run from the relay dir so Bun loads relay/.env. Bun only reads .env
# from the CWD, never from the script location.
(cd "$PROJECT_DIR/relay" && PORT="$RELAY_PORT" bun src/index.ts) >"$RELAY_LOG" 2>&1 &
RELAY_PID=$!

relay_ready=false
for ((attempt = 1; attempt <= 60; attempt++)); do
    if ! kill -0 "$RELAY_PID" 2>/dev/null; then
        log ""
        log "Relay exited during startup:"
        tail -n 40 "$RELAY_LOG" 2>/dev/null || true
        fail "Relay exited during startup."
    fi

    if curl -sS -o /dev/null --max-time 1 "http://127.0.0.1:${RELAY_PORT}/api/health" 2>/dev/null; then
        relay_ready=true
        break
    fi

    sleep 0.5
done

if [[ "$relay_ready" != true ]]; then
    log ""
    log "Relay did not respond within timeout:"
    tail -n 40 "$RELAY_LOG" 2>/dev/null || true
    fail "Relay did not respond within the startup timeout."
fi

log "Relay is responding."
log ""
log "Health:"
curl -sS --max-time 2 "http://127.0.0.1:${RELAY_PORT}/api/health" 2>/dev/null || true
log ""
log "Presence status:"
curl -sS --max-time 2 "http://127.0.0.1:${RELAY_PORT}/api/presence/status" 2>/dev/null || true
log ""
log "Test it (while a track plays in Photon):"
log "  curl -sS -X POST http://127.0.0.1:${RELAY_PORT}/api/presence \\"
log "    -H 'content-type: application/json' \\"
log "    -d '{\"title\":\"Test Song\",\"artist\":\"Test Artist\",\"durationSec\":200,\"positionSec\":10,\"playing\":true}'"
log ""
log "Press Ctrl+C to stop the relay (presence is cleared on shutdown)."

wait "$RELAY_PID"
