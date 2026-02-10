#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Validate Configuration
# =============================================================================
# Checks that everything is properly configured before launching.
# Run this before make launch to catch issues early.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

pass() { echo -e "  ${GREEN}✓${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*"; ((ERRORS++)); }
warn() { echo -e "  ${YELLOW}!${NC} $*"; ((WARNINGS++)); }

echo "Validating OpenClaw + Ollama Docker configuration..."
echo ""

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
echo "Prerequisites:"

if command -v docker &>/dev/null; then
  pass "Docker installed"
else
  fail "Docker not found"
fi

if docker compose version &>/dev/null; then
  pass "Docker Compose v2 available"
else
  fail "Docker Compose v2 not found"
fi

if command -v jq &>/dev/null; then
  pass "jq installed"
else
  warn "jq not installed (needed for some scripts)"
fi

if command -v curl &>/dev/null; then
  pass "curl installed"
else
  warn "curl not installed (needed for API calls)"
fi

# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------
echo ""
echo "Configuration files:"

if [ -f ".env" ]; then
  pass ".env exists"
  source .env 2>/dev/null
else
  fail ".env missing (run: cp .env.example .env)"
fi

if [ -f "docker-compose.yml" ]; then
  pass "docker-compose.yml exists"
else
  fail "docker-compose.yml missing"
fi

if [ -f "Dockerfile.openclaw" ]; then
  pass "Dockerfile.openclaw exists"
else
  fail "Dockerfile.openclaw missing"
fi

if [ -f "agents.yml" ]; then
  pass "agents.yml exists"
else
  warn "agents.yml missing (needed for static agents)"
fi

if [ -f "proxy/squid.conf" ]; then
  pass "proxy/squid.conf exists"
else
  fail "proxy/squid.conf missing (network isolation won't work)"
fi

if [ -f "docker-compose.agents.yml" ]; then
  pass "docker-compose.agents.yml exists (generated)"
else
  warn "docker-compose.agents.yml missing (run: make agents-gen)"
fi

# ---------------------------------------------------------------------------
# Docker image
# ---------------------------------------------------------------------------
echo ""
echo "Docker images:"

if docker image inspect "${OPENCLAW_IMAGE:-openclaw:local}" &>/dev/null; then
  pass "OpenClaw image exists (${OPENCLAW_IMAGE:-openclaw:local})"
else
  fail "OpenClaw image not built (run: make build)"
fi

if docker image inspect ollama/ollama:latest &>/dev/null; then
  pass "Ollama image exists"
else
  warn "Ollama image not pulled (will pull on first run)"
fi

# ---------------------------------------------------------------------------
# Data directories
# ---------------------------------------------------------------------------
echo ""
echo "Data directories:"

for dir in "data/openclaw-config" "data/openclaw-workspace" "data/ollama-models" "data/agents" "data/logs"; do
  if [ -d "$dir" ]; then
    pass "$dir exists"
  else
    warn "$dir missing (will be created on first run)"
  fi
done

# ---------------------------------------------------------------------------
# Agent configs
# ---------------------------------------------------------------------------
echo ""
echo "Agent configurations:"

if [ -d "data/agents" ]; then
  AGENT_COUNT=$(find data/agents -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
  if [ "$AGENT_COUNT" -gt 0 ]; then
    pass "$AGENT_COUNT agent(s) configured"
    
    for agent_dir in data/agents/*/; do
      agent_name=$(basename "$agent_dir")
      
      if [ -f "$agent_dir/config/openclaw.json" ]; then
        # Validate JSON
        if jq empty "$agent_dir/config/openclaw.json" 2>/dev/null; then
          pass "  $agent_name: config valid"
        else
          fail "  $agent_name: config/openclaw.json is invalid JSON"
        fi
      else
        fail "  $agent_name: missing config/openclaw.json"
      fi
      
      if [ -f "$agent_dir/workspace/SOUL.md" ]; then
        pass "  $agent_name: SOUL.md present"
      else
        warn "  $agent_name: missing SOUL.md"
      fi
    done
  else
    warn "No agents configured (run: make agents-gen)"
  fi
else
  warn "No agent data directory"
fi

# ---------------------------------------------------------------------------
# Network check
# ---------------------------------------------------------------------------
echo ""
echo "Network:"

if grep -q "discord.com" proxy/squid.conf 2>/dev/null; then
  pass "Squid proxy allows Discord domains"
else
  fail "Squid proxy config doesn't include Discord domains"
fi

if grep -q "internal: true" docker-compose.yml 2>/dev/null; then
  pass "Internal network isolation configured"
else
  warn "Internal network not set to internal: true"
fi

# ---------------------------------------------------------------------------
# Docker compose validation
# ---------------------------------------------------------------------------
echo ""
echo "Compose validation:"

if docker compose config --quiet 2>/dev/null; then
  pass "docker-compose.yml is valid"
else
  fail "docker-compose.yml has errors"
fi

if [ -f "docker-compose.agents.yml" ]; then
  if docker compose -f docker-compose.yml -f docker-compose.agents.yml config --quiet 2>/dev/null; then
    pass "docker-compose.agents.yml is valid"
  else
    fail "docker-compose.agents.yml has errors"
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=================================="
if [ "$ERRORS" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo -e "${GREEN}All checks passed! Ready to launch.${NC}"
elif [ "$ERRORS" -eq 0 ]; then
  echo -e "${YELLOW}$WARNINGS warning(s), no errors. Should work but check warnings.${NC}"
else
  echo -e "${RED}$ERRORS error(s), $WARNINGS warning(s). Fix errors before launching.${NC}"
  exit 1
fi
