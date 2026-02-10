#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Launch Experiment — Full automated startup
# =============================================================================
# Brings up the entire stack: Ollama, proxy, controller, static agents.
# Optionally auto-spawns random agents to hit target count.
#
# Usage: bash scripts/launch-experiment.sh [--auto-spawn N]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

source .env 2>/dev/null || true

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $*"; }
info() { echo -e "${BLUE}[i]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }

AUTO_SPAWN=0
if [ "${1:-}" = "--auto-spawn" ] && [ -n "${2:-}" ]; then
  AUTO_SPAWN="$2"
fi

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   🧪 Launching Agent Experiment           ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""

# ---------------------------------------------------------------------------
# 1. Start infrastructure
# ---------------------------------------------------------------------------
info "Starting infrastructure (Ollama + Proxy + Controller)..."
docker compose up -d ollama discord-proxy spawn-controller
log "Infrastructure started"

# Wait for services
info "Waiting for Ollama..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:${OLLAMA_PORT:-11434}/api/tags &>/dev/null; then break; fi
  sleep 2
done
log "Ollama ready"

info "Waiting for spawn controller..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:${CONTROLLER_PORT:-9090}/limits &>/dev/null; then break; fi
  sleep 2
done
log "Controller ready"

# ---------------------------------------------------------------------------
# 2. Start static agents (from docker-compose.agents.yml)
# ---------------------------------------------------------------------------
if [ -f "docker-compose.agents.yml" ]; then
  info "Starting static agents..."
  docker compose -f docker-compose.yml -f docker-compose.agents.yml up -d
  log "Static agents started"
else
  warn "No docker-compose.agents.yml found. Run: make agents-gen"
fi

# ---------------------------------------------------------------------------
# 3. Auto-spawn random agents if requested
# ---------------------------------------------------------------------------
if [ "$AUTO_SPAWN" -gt 0 ]; then
  info "Auto-spawning $AUTO_SPAWN random agents..."
  for i in $(seq 1 "$AUTO_SPAWN"); do
    RESULT=$(curl -sf -X POST http://localhost:${CONTROLLER_PORT:-9090}/agents/random \
      -H "Content-Type: application/json" -d '{}' 2>/dev/null || echo '{"error":"spawn failed"}')
    
    NAME=$(echo "$RESULT" | jq -r '.agent.name // "unknown"')
    if [ "$NAME" != "unknown" ] && [ "$NAME" != "null" ]; then
      log "Spawned: $NAME"
    else
      ERROR=$(echo "$RESULT" | jq -r '.error // "unknown error"')
      warn "Spawn failed: $ERROR"
    fi
    
    # Respect cooldown
    if [ "$i" -lt "$AUTO_SPAWN" ]; then
      sleep "${SPAWN_COOLDOWN_SEC:-30}"
    fi
  done
fi

# ---------------------------------------------------------------------------
# 4. Print status
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Experiment Running!                     ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"
echo ""

# Show agent status
LIMITS=$(curl -sf http://localhost:${CONTROLLER_PORT:-9090}/limits 2>/dev/null)
AGENTS_ACTIVE=$(echo "$LIMITS" | jq -r '.usage.activeAgents')
TOKENS_AVAIL=$(curl -sf http://localhost:${CONTROLLER_PORT:-9090}/tokens 2>/dev/null | jq -r '.available')

echo "  Dashboard:     http://localhost:${CONTROLLER_PORT:-9090}/dashboard"
echo "  Agents active: $AGENTS_ACTIVE"
echo "  Tokens avail:  $TOKENS_AVAIL"
echo ""
echo "  Useful commands:"
echo "    make agents-logs          # Watch agent conversations"
echo "    make spawn-random         # Add a random agent"
echo "    make topic                # Get a conversation starter"
echo "    make experiment-summary   # Analytics"
echo "    make emergency-stop       # Kill all spawned agents"
echo ""
echo "  Tail everything:"
echo "    docker compose -f docker-compose.yml -f docker-compose.agents.yml logs -f"
echo ""
