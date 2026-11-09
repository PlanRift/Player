#!/usr/bin/env bash
# Plenrip Audio runner: Navidrome + lyrics relay + file bridge + frontend.
# Rewritten 2026-11-09: the old script ran `bun run dev` (Turbo), which
# does not exist in this vanilla tree, so the relay never started and the
# lyrics providers all showed "Unreachable". Each service now starts
# directly and is health-checked before the runner reports ready.
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# Ports (override with env vars).
WEB_PORT="${WEB_PORT:-5500}"
LYRICS_PORT="${LYRICS_PORT:-3005}"
BRIDGE_PORT="${BRIDGE_PORT:-3001}"

export ND_PORT="${ND_PORT:-4533}"
export ND_ADDRESS="${ND_ADDRESS:-127.0.0.1}"

# Set BRIDGE=0 to skip the NAS file bridge (lyrics + frontend still run).
BRIDGE="${BRIDGE:-1}"

# Set KILL_PORTS=1 to automatically terminate any processes occupying required ports.
KILL_PORTS="${KILL_PORTS:-1}"

# Do not force scanner purge behavior here.
# Existing Navidrome configuration/environment remains authoritative.

if [[ -z "${ND_MUSICFOLDER:-}" ]]; then
    if [[ -d "/home/aethzer1on/Music/Mornye" ]]; then
        export ND_MUSICFOLDER="/home/aethzer1on/Music/Mornye"
    elif [[ -d "$HOME/Music" ]]; then
        export ND_MUSICFOLDER="$HOME/Music"
    else
        export ND_MUSICFOLDER="$PROJECT_DIR/music"
    fi
fi

export ND_DATAFOLDER="${ND_DATAFOLDER:-$PROJECT_DIR/.navidrome-data}"

mkdir -p "$ND_MUSICFOLDER" "$ND_DATAFOLDER"

BACKEND_URL="http://${ND_ADDRESS}:${ND_PORT}"
WEB_URL="http://localhost:${WEB_PORT}"
RELAY_URL="http://localhost:${LYRICS_PORT}"
BRIDGE_URL="http://localhost:${BRIDGE_PORT}"
LOG_DIR="$PROJECT_DIR/.runner-logs"
BACKEND_LOG="$LOG_DIR/navidrome.log"
RELAY_LOG="$LOG_DIR/relay.log"
BRIDGE_LOG="$LOG_DIR/bridge.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

mkdir -p "$LOG_DIR"

NAVIDROME_PID=""
RELAY_PID=""
BRIDGE_PID=""
FRONTEND_PID=""

log() {
    printf '%s\n' "$*"
}

fail() {
    printf '\nERROR: %s\n' "$*" >&2
    exit 1
}

# Stop every service this runner started (and only those).
cleanup() {
    local status=$?

    trap - EXIT INT TERM

    log ""
    log "Stopping services started by this runner..."

    for pid in "$FRONTEND_PID" "$BRIDGE_PID" "$RELAY_PID" "$NAVIDROME_PID"; do
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done

    for ((attempt = 0; attempt < 20; attempt++)); do
        local still_running=false
        for pid in "$FRONTEND_PID" "$BRIDGE_PID" "$RELAY_PID" "$NAVIDROME_PID"; do
            if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
                still_running=true
            fi
        done
        [[ "$still_running" == false ]] && break
        sleep 0.1
    done

    for pid in "$FRONTEND_PID" "$BRIDGE_PID" "$RELAY_PID" "$NAVIDROME_PID"; do
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            kill -KILL "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
    done

    log "Shutdown complete."
    exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for tool in curl bun node ss; do
    command -v "$tool" >/dev/null 2>&1 ||
        fail "Required command not found: $tool"
done

[[ -f "$PROJECT_DIR/package.json" ]] ||
    fail "package.json not found in $PROJECT_DIR"

[[ -f "$PROJECT_DIR/client/index.html" ]] ||
    fail "client/index.html not found in $PROJECT_DIR"

[[ -d "$PROJECT_DIR/relay" ]] ||
    fail "relay/ not found in $PROJECT_DIR"

find_navidrome() {
    if command -v navidrome >/dev/null 2>&1; then
        command -v navidrome
        return 0
    fi

    local candidate

    for candidate in \
        "/usr/local/bin/navidrome" \
        "/usr/bin/navidrome"; do
        if [[ -x "$candidate" ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done

    if [[ -d /nix/store ]]; then
        candidate="$(
            find /nix/store \
                -maxdepth 4 \
                -name navidrome \
                -type f \
                -perm -111 \
                -print -quit \
                2>/dev/null || true
        )"

        if [[ -n "$candidate" && -x "$candidate" ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    fi

    return 1
}

backend_responds() {
    local response

    response="$(
        curl -sS --max-time 2 \
            "${BACKEND_URL}/rest/ping.view?u=any&t=any&s=any&v=1.16.1&c=plenrip-runner&f=json" \
            2>/dev/null
    )" || return 1

    # This verifies a Navidrome response, not a successful login.
    [[ "$response" == *'"subsonic-response"'* &&
       "$response" == *'"navidrome"'* ]]
}

http_ok() {
    curl -sS --max-time 2 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null |
        grep -q '^200$'
}

port_in_use() {
    local port="$1"
    local listeners

    listeners="$(ss -H -ltn "sport = :${port}" 2>/dev/null)" ||
        return 1

    [[ -n "$listeners" ]]
}

kill_port() {
    local port="$1"
    local pids
    pids="$(ss -ltnp "sport = :${port}" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)"
    if [[ -z "$pids" ]] && command -v fuser >/dev/null 2>&1; then
        pids="$(fuser "${port}/tcp" 2>/dev/null || true)"
    fi

    if [[ -n "$pids" ]]; then
        log "Port $port is occupied by PID(s): $pids. Stopping existing process..."
        for pid in $pids; do
            if kill -0 "$pid" 2>/dev/null; then
                kill -TERM "$pid" 2>/dev/null || true
            fi
        done

        local attempt
        for ((attempt = 1; attempt <= 15; attempt++)); do
            if ! port_in_use "$port"; then
                log "Port $port is now free."
                return 0
            fi
            sleep 0.2
        done

        for pid in $pids; do
            if kill -0 "$pid" 2>/dev/null; then
                kill -KILL "$pid" 2>/dev/null || true
            fi
        done

        sleep 0.5
        if port_in_use "$port"; then
            fail "Failed to free port $port (occupied by PID: $pids)."
        else
            log "Port $port has been forcefully freed."
        fi
    fi
}

# The bridge requires x-api-key auth, so an unauthenticated request gets
# 401: that still proves the server is up. Accept 200 or 401 here.
http_bridge_up() {
    local code
    code="$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)" || return 1
    [[ "$code" == "200" || "$code" == "401" ]]
}

# Wait up to $2 seconds for $1 (a URL) to answer 200, else fail with $3.
wait_for_http() {
    local url="$1" timeout="$2" name="$3" logfile="$4"
    local attempt
    for ((attempt = 1; attempt <= timeout * 2; attempt++)); do
        if [[ "$name" == "Lyrics relay" && -n "${RELAY_PID:-}" ]] && ! kill -0 "$RELAY_PID" 2>/dev/null; then
            log ""
            log "$name exited during startup:"
            tail -n 40 "$logfile" 2>/dev/null || true
            fail "$name exited during startup."
        fi
        if http_ok "$url"; then
            log "$name is responding."
            return 0
        fi
        sleep 0.5
    done
    log ""
    log "$name did not respond within ${timeout}s:"
    tail -n 40 "$logfile" 2>/dev/null || true
    fail "$name did not respond within the startup timeout."
}

# Same as wait_for_http, but for the bridge (200 or 401 both mean "up").
wait_for_bridge() {
    local url="$1" timeout="$2" name="$3" logfile="$4"
    local attempt
    for ((attempt = 1; attempt <= timeout * 2; attempt++)); do
        if http_bridge_up "$url"; then
            log "$name is responding."
            return 0
        fi
        sleep 0.5
    done
    log ""
    log "$name did not respond within ${timeout}s:"
    tail -n 40 "$logfile" 2>/dev/null || true
    fail "$name did not respond within the startup timeout."
}

log "========================================================"
log "  Plenrip Audio: Navidrome + Relay + Bridge + Frontend"
log "========================================================"
log ""
log "Project: $PROJECT_DIR"

# Avoid starting a second copy on top of an existing run.
for port in "$WEB_PORT" "$LYRICS_PORT" "$BRIDGE_PORT"; do
    if [[ "$port" == "$BRIDGE_PORT" && "$BRIDGE" == "0" ]]; then
        continue
    fi
    if port_in_use "$port"; then
        if [[ "$KILL_PORTS" == "1" ]]; then
            kill_port "$port"
        else
            log ""
            log "A process is already listening on port $port:"
            ss -ltnp "sport = :${port}" || true
            log ""
            log "Your previous runner may still be running."
            log "Open $WEB_URL, or stop the previous runner with Ctrl+C."
            fail "Stop the existing services before starting a new run."
        fi
    fi
done

log ""
log "Checking backend: $BACKEND_URL"

if backend_responds; then
    log "Navidrome is already responding."
    log "Reusing it; this runner will not stop that existing server."
else
    if port_in_use "$ND_PORT"; then
        fail "Port $ND_PORT is occupied, but no Navidrome response was detected."
    fi

    NAVIDROME_BIN="${NAVIDROME_BIN:-}"

    if [[ -z "$NAVIDROME_BIN" ]]; then
        NAVIDROME_BIN="$(find_navidrome || true)"
    fi

    [[ -n "$NAVIDROME_BIN" && -x "$NAVIDROME_BIN" ]] ||
        fail "Navidrome executable not found. Set NAVIDROME_BIN or add it to PATH."

    log "Starting Navidrome..."
    log "  Binary: $NAVIDROME_BIN"
    log "  Music:  $ND_MUSICFOLDER"
    log "  Data:   $ND_DATAFOLDER"
    log "  Log:    $BACKEND_LOG"

    "$NAVIDROME_BIN" >"$BACKEND_LOG" 2>&1 &
    NAVIDROME_PID=$!

    backend_ready=false

    for ((attempt = 1; attempt <= 60; attempt++)); do
        if ! kill -0 "$NAVIDROME_PID" 2>/dev/null; then
            tail -n 80 "$BACKEND_LOG" || true
            fail "Navidrome exited during startup."
        fi

        if backend_responds; then
            backend_ready=true
            break
        fi

        sleep 0.5
    done

    if [[ "$backend_ready" != true ]]; then
        tail -n 80 "$BACKEND_LOG" || true
        fail "Navidrome did not respond within the startup timeout."
    fi

    log "Navidrome is responding."
fi

log ""
log "Backend reachability verified. Account credentials are NOT verified."
log "Sign in from the app: Settings > Navidrome Server."
log ""

# --- Lyrics relay (Bun, port 3005) ---
# The relay is a Bun project with real dependencies (kuroshiro + kuromoji
# dict, 3DES for QRC, ...). A fresh unzip has no node_modules, and the
# relay then dies at startup with "Cannot find package 'kuroshiro'" and
# every Lyrics Source shows Unreachable. Install once when the deps are
# missing; a present node_modules is left untouched.
if [[ ! -d "$PROJECT_DIR/relay/node_modules" ]]; then
    log "Installing lyrics relay dependencies (bun install)..."
    (cd "$PROJECT_DIR/relay" && bun install) || fail "bun install failed for the lyrics relay"
fi
log "Starting lyrics relay..."
log "  Log: $RELAY_LOG"
PORT="$LYRICS_PORT" bun "$PROJECT_DIR/relay/src/index.ts" >"$RELAY_LOG" 2>&1 &
RELAY_PID=$!
wait_for_http "$RELAY_URL/api/health" 30 "Lyrics relay" "$RELAY_LOG"

# --- NAS file bridge (Node, port 3001) ---
if [[ "$BRIDGE" != "0" ]]; then
    # The bridge requires a real NAS API key (it refuses the placeholder).
    # If none is set, generate one once and persist it, so the key stays
    # stable across runs. Enter it in the app under Settings > NAS Storage.
    NAS_KEY_FILE="$PROJECT_DIR/.nas-api-key"
    if [[ -z "${NAS_API_KEY:-}" ]]; then
        if [[ -f "$NAS_KEY_FILE" ]]; then
            NAS_API_KEY="$(cat "$NAS_KEY_FILE")"
        else
            NAS_API_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
            (umask 077; printf '%s' "$NAS_API_KEY" > "$NAS_KEY_FILE")
            log "Generated a NAS API key and saved it to .nas-api-key (mode 600)."
        fi
    fi
    export NAS_API_KEY
    log "Starting file bridge..."
    log "  Log: $BRIDGE_LOG"
    log "  NAS API key: $NAS_API_KEY"
    log "  (Enter this key in the app under Settings > NAS Storage.)"
    FILE_BRIDGE_PORT="$BRIDGE_PORT" node "$PROJECT_DIR/server/file-bridge.js" >"$BRIDGE_LOG" 2>&1 &
    BRIDGE_PID=$!
    wait_for_bridge "$BRIDGE_URL/api/files/list?path=" 30 "File bridge" "$BRIDGE_LOG"
else
    log "File bridge skipped (BRIDGE=0)."
fi

# --- Frontend (Node static server) ---
log "Starting frontend..."
log "  Log: $FRONTEND_LOG"
WEB_PORT="$WEB_PORT" node "$PROJECT_DIR/server/serve.js" >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
wait_for_http "$WEB_URL/" 30 "Frontend" "$FRONTEND_LOG"

log ""
log "All services are up:"
log "  Frontend:    $WEB_URL"
log "  Lyrics relay: $RELAY_URL"
if [[ "$BRIDGE" != "0" ]]; then
    log "  File bridge:  $BRIDGE_URL"
fi
log "  Navidrome:    $BACKEND_URL"
log ""
log "Press Ctrl+C to stop all services started by this runner."
log "--------------------------------------------------------"

wait "$FRONTEND_PID"
