#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Health check for OpenClaw + Ollama stack
# Usage: ./scripts/health.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

source .env 2>/dev/null || true

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0

check() {
  local name="$1"
  local cmd="$2"
  
  if eval "$cmd" &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} $name"
  else
    echo -e "  ${RED}✗${NC} $name"
    ((ERRORS++))
  fi
}

echo "OpenClaw + Ollama Health Check"
echo "=============================="
echo ""

echo "Services:"
check "Ollama container running" "docker compose ps ollama --format json 2>/dev/null | grep -q running"
check "OpenClaw gateway running" "docker compose ps openclaw-gateway --format json 2>/dev/null | grep -q running"

echo ""
echo "Connectivity:"
check "Ollama API responding" "curl -sf http://localhost:${OLLAMA_PORT:-11434}/api/tags"
check "OpenClaw gateway responding" "curl -sf http://localhost:${OPENCLAW_GATEWAY_PORT:-18789}/health 2>/dev/null || curl -sf http://localhost:${OPENCLAW_GATEWAY_PORT:-18789}/ 2>/dev/null"

echo ""
echo "Models:"
MODELS=$(docker compose exec ollama ollama list 2>/dev/null | tail -n +2)
if [ -n "$MODELS" ]; then
  echo -e "  ${GREEN}✓${NC} Models installed:"
  echo "$MODELS" | while read -r line; do
    echo "    $line"
  done
else
  echo -e "  ${YELLOW}!${NC} No models installed"
  echo "    Run: make pull-model MODEL=qwen3-coder"
fi

echo ""
echo "Storage:"
CONFIG_SIZE=$(du -sh "${OPENCLAW_CONFIG_DIR:-./data/openclaw-config}" 2>/dev/null | cut -f1 || echo "N/A")
WORKSPACE_SIZE=$(du -sh "${OPENCLAW_WORKSPACE_DIR:-./data/openclaw-workspace}" 2>/dev/null | cut -f1 || echo "N/A")
MODELS_SIZE=$(du -sh "${OLLAMA_DATA_DIR:-./data/ollama-models}" 2>/dev/null | cut -f1 || echo "N/A")
echo "  Config:    $CONFIG_SIZE"
echo "  Workspace: $WORKSPACE_SIZE"
echo "  Models:    $MODELS_SIZE"

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo -e "${GREEN}All checks passed ✓${NC}"
else
  echo -e "${RED}$ERRORS check(s) failed${NC}"
  exit 1
fi
