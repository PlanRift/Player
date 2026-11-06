#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# These ports describe your current dev setup.
# WEB_PORT does not override vite.config.ts or package.json.
WEB_PORT="${WEB_PORT:-5500}"
LYRICS_PORT="${LYRICS_PORT:-3005}"

export ND_PORT="${ND_PORT:-4533}"
export ND_ADDRESS="${ND_ADDRESS:-127.0.0.1}"

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
LOG_DIR="$PROJECT_DIR/.runner-logs"
BACKEND_LOG="$LOG_DIR/navidrome.log"

mkdir -p "$LOG_DIR"

NAVIDROME_PID=""
DEV_PID=""
DEV_PROCESS_GROUP=false

log() {
    printf '%s\n' "$*"
}

fail() {
    printf '\nERROR: %s\n' "$*" >&2
    exit 1
}

cleanup() {
    local status=$?

    trap - EXIT INT TERM

    log ""
    log "Stopping services started by this runner..."

    if [[ -n "$DEV_PID" ]]; then
        if [[ "$DEV_PROCESS_GROUP" == true ]]; then
            kill -TERM -- "-$DEV_PID" 2>/dev/null || true
        elif kill -0 "$DEV_PID" 2>/dev/null; then
            kill -TERM "$DEV_PID" 2>/dev/null || true
        fi
    fi

    if [[ -n "$NAVIDROME_PID" ]] &&
       kill -0 "$NAVIDROME_PID" 2>/dev/null; then
        kill -TERM "$NAVIDROME_PID" 2>/dev/null || true
    fi

    # Wait briefly, then clean up only processes owned by this runner.
    for ((attempt = 0; attempt < 20; attempt++)); do
        local still_running=false

        if [[ -n "$DEV_PID" ]]; then
            if [[ "$DEV_PROCESS_GROUP" == true ]]; then
                if kill -0 -- "-$DEV_PID" 2>/dev/null; then
                    still_running=true
                fi
            elif kill -0 "$DEV_PID" 2>/dev/null; then
                still_running=true
            fi
        fi

        if [[ -n "$NAVIDROME_PID" ]] &&
           kill -0 "$NAVIDROME_PID" 2>/dev/null; then
            still_running=true
        fi

        if [[ "$still_running" == false ]]; then
            break
        fi

        sleep 0.1
    done

    if [[ -n "$DEV_PID" ]]; then
        if [[ "$DEV_PROCESS_GROUP" == true ]]; then
            kill -KILL -- "-$DEV_PID" 2>/dev/null || true
        elif kill -0 "$DEV_PID" 2>/dev/null; then
            kill -KILL "$DEV_PID" 2>/dev/null || true
        fi

        wait "$DEV_PID" 2>/dev/null || true
    fi

    if [[ -n "$NAVIDROME_PID" ]]; then
        if kill -0 "$NAVIDROME_PID" 2>/dev/null; then
            kill -KILL "$NAVIDROME_PID" 2>/dev/null || true
        fi

        wait "$NAVIDROME_PID" 2>/dev/null || true
    fi

    log "Shutdown complete."
    exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for tool in curl bun ss; do
    command -v "$tool" >/dev/null 2>&1 ||
        fail "Required command not found: $tool"
done

[[ -f "$PROJECT_DIR/package.json" ]] ||
    fail "package.json not found in $PROJECT_DIR"

[[ -f "$PROJECT_DIR/index.html" ]] ||
    fail "index.html not found in $PROJECT_DIR"

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
            "${BACKEND_URL}/rest/ping.view?u=any&t=any&s=any&v=1.16.1&c=century-runner&f=json" \
            2>/dev/null
    )" || return 1

    # This verifies a Navidrome response, not a successful login.
    [[ "$response" == *'"subsonic-response"'* &&
       "$response" == *'"navidrome"'* ]]
}

port_in_use() {
    local port="$1"
    local listeners

    listeners="$(ss -H -ltn "sport = :${port}" 2>/dev/null)" ||
        return 1

    [[ -n "$listeners" ]]
}

log "========================================================"
log "  Century: Music Client + Navidrome"
log "========================================================"
log ""
log "Project: $PROJECT_DIR"

# Avoid starting a second frontend/relay on top of an existing run.
for port in "$WEB_PORT" "$LYRICS_PORT"; do
    if port_in_use "$port"; then
        log ""
        log "A process is already listening on port $port:"
        ss -ltnp "sport = :${port}" || true
        log ""
        log "Your previous development server may still be running."
        log "Open $WEB_URL, or stop the previous runner with Ctrl+C."
        fail "Stop the existing dev services before starting a new run."
    fi
done

# Preserve existing credentials and configuration.
if [[ ! -f "$PROJECT_DIR/.env" ]]; then
    if [[ -f "$PROJECT_DIR/.env.example" ]]; then
        cp \
            "$PROJECT_DIR/.env.example" \
            "$PROJECT_DIR/.env"

        log "Created .env from .env.example."
    else
        (
            umask 077

            cat > "$PROJECT_DIR/.env" <<EOF
VITE_NAVIDROME_URL=${BACKEND_URL}
VITE_NAVIDROME_USER=
VITE_NAVIDROME_PASSWORD=
EOF
        )

        log "Created .env with backend URL."
        log "Credentials are blank; configure your existing Navidrome account."
    fi
else
    log "Keeping existing .env unchanged."
fi

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
log ""
log "Starting frontend and lyrics relay with: bun run dev"
log ""
log "Expected frontend: $WEB_URL"
log "Expected relay:    http://localhost:${LYRICS_PORT}"
log "Navidrome:         $BACKEND_URL"
log ""
log "Use the actual Local URL printed by the frontend below."
log "WEB_PORT is a runner hint, not a Vite configuration override."
log "Press Ctrl+C to stop services started by this runner."
log "--------------------------------------------------------"

# Start Turbo and its children in a separate process group when available.
if command -v setsid >/dev/null 2>&1; then
    setsid bun run dev &
    DEV_PID=$!
    DEV_PROCESS_GROUP=true
else
    log "Warning: setsid unavailable; child-process cleanup may be limited."
    bun run dev &
    DEV_PID=$!
fi

wait "$DEV_PID"