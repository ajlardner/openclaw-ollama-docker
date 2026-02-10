#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# OpenClaw + Ollama Docker — Interactive Setup
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }
info() { echo -e "${BLUE}[i]${NC} $*"; }

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    err "Missing dependency: $1"
    echo "  Install it and re-run this script."
    exit 1
  fi
}

require_cmd docker
require_cmd docker

# Check Docker Compose v2
if ! docker compose version &>/dev/null; then
  err "Docker Compose v2 is required. Install Docker Desktop or the compose plugin."
  exit 1
fi

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   OpenClaw + Ollama Docker Setup          ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""

# ---------------------------------------------------------------------------
# Create .env from template if it doesn't exist
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  log "Created .env from template"
else
  info ".env already exists, using existing config"
fi

# ---------------------------------------------------------------------------
# GPU detection
# ---------------------------------------------------------------------------
HAS_GPU=false
PROFILE_FLAGS=""

if command -v nvidia-smi &>/dev/null; then
  if nvidia-smi &>/dev/null; then
    HAS_GPU=true
    log "NVIDIA GPU detected"
    
    # Check for NVIDIA Container Toolkit
    if docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi &>/dev/null 2>&1; then
      log "NVIDIA Container Toolkit is working"
    else
      warn "NVIDIA Container Toolkit not detected — GPU passthrough won't work"
      warn "Install: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html"
      HAS_GPU=false
    fi
  fi
fi

if [ "$HAS_GPU" = true ]; then
  read -rp "Use GPU acceleration? [Y/n] " use_gpu
  if [[ "${use_gpu:-Y}" =~ ^[Yy]$ ]]; then
    PROFILE_FLAGS="--profile gpu"
    log "GPU profile enabled"
  fi
else
  info "No NVIDIA GPU detected — running CPU-only"
fi

# ---------------------------------------------------------------------------
# Model selection
# ---------------------------------------------------------------------------
echo ""
echo "Select a model size:"
echo "  1) Minimal  — phi:3.8b     (~2 GB, fast, 8GB+ RAM)"
echo "  2) Standard — qwen3-coder  (~5 GB, balanced, 16GB+ RAM)"
echo "  3) Large    — glm-4.7      (~8 GB, high quality, 32GB+ RAM)"
echo "  4) Custom   — enter your own model name"
echo ""
read -rp "Choice [2]: " model_choice

case "${model_choice:-2}" in
  1) OLLAMA_MODEL="phi:3.8b"; CONFIG_TEMPLATE="ollama-minimal.json" ;;
  2) OLLAMA_MODEL="qwen3-coder"; CONFIG_TEMPLATE="ollama-default.json" ;;
  3) OLLAMA_MODEL="glm-4.7"; CONFIG_TEMPLATE="ollama-gpu.json" ;;
  4) read -rp "Model name: " OLLAMA_MODEL; CONFIG_TEMPLATE="ollama-default.json" ;;
  *) OLLAMA_MODEL="qwen3-coder"; CONFIG_TEMPLATE="ollama-default.json" ;;
esac

# Update .env with selected model (portable sed for macOS + Linux)
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' "s/^OLLAMA_MODELS=.*/OLLAMA_MODELS=${OLLAMA_MODEL}/" .env
else
  sed -i "s/^OLLAMA_MODELS=.*/OLLAMA_MODELS=${OLLAMA_MODEL}/" .env
fi
log "Selected model: $OLLAMA_MODEL"

# ---------------------------------------------------------------------------
# Reverse proxy
# ---------------------------------------------------------------------------
echo ""
read -rp "Set up HTTPS reverse proxy (Caddy)? [y/N] " use_proxy
if [[ "${use_proxy:-N}" =~ ^[Yy]$ ]]; then
  PROFILE_FLAGS="$PROFILE_FLAGS --profile proxy"
  read -rp "Domain name: " domain
  read -rp "Email for Let's Encrypt: " acme_email
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/^# DOMAIN=.*/DOMAIN=${domain}/" .env
    sed -i '' "s/^# ACME_EMAIL=.*/ACME_EMAIL=${acme_email}/" .env
  else
    sed -i "s/^# DOMAIN=.*/DOMAIN=${domain}/" .env
    sed -i "s/^# ACME_EMAIL=.*/ACME_EMAIL=${acme_email}/" .env
  fi
  log "Proxy configured for $domain"
fi

# ---------------------------------------------------------------------------
# Create data directories
# ---------------------------------------------------------------------------
mkdir -p data/openclaw-config data/openclaw-workspace data/ollama-models
log "Data directories created"

# ---------------------------------------------------------------------------
# Build OpenClaw image
# ---------------------------------------------------------------------------
echo ""
info "Building OpenClaw image (this may take a few minutes on first run)..."
EXTRA_APT=""
if [ -n "${OPENCLAW_DOCKER_APT_PACKAGES:-}" ]; then
  EXTRA_APT="--build-arg EXTRA_APT_PACKAGES=${OPENCLAW_DOCKER_APT_PACKAGES}"
fi
docker build -t openclaw:local -f Dockerfile.openclaw $EXTRA_APT .
log "OpenClaw image built"

# ---------------------------------------------------------------------------
# Start services
# ---------------------------------------------------------------------------
echo ""
info "Starting services..."
docker compose $PROFILE_FLAGS up -d
log "Services started"

# Wait for Ollama to be healthy
info "Waiting for Ollama to be ready..."
for i in $(seq 1 30); do
  if docker compose exec ollama curl -sf http://localhost:11434/api/tags &>/dev/null; then
    break
  fi
  sleep 2
done
log "Ollama is ready"

# ---------------------------------------------------------------------------
# Pull model
# ---------------------------------------------------------------------------
echo ""
info "Pulling model: $OLLAMA_MODEL (this may take a while)..."
docker compose exec ollama ollama pull "$OLLAMA_MODEL"
log "Model pulled: $OLLAMA_MODEL"

# Pull nomic-embed-text for memory search if using GPU config
if [ "$CONFIG_TEMPLATE" = "ollama-gpu.json" ]; then
  info "Pulling embedding model for memory search..."
  docker compose exec ollama ollama pull nomic-embed-text
  log "Embedding model ready"
fi

# ---------------------------------------------------------------------------
# Run OpenClaw onboarding
# ---------------------------------------------------------------------------
echo ""
info "Running OpenClaw onboarding wizard..."
docker compose run --rm openclaw-cli onboard

# ---------------------------------------------------------------------------
# Apply config template
# ---------------------------------------------------------------------------
if [ -f "config/templates/$CONFIG_TEMPLATE" ]; then
  info "You can apply the $CONFIG_TEMPLATE config template by running:"
  echo "  cp config/templates/$CONFIG_TEMPLATE data/openclaw-config/openclaw.json"
  echo "  docker compose restart openclaw-gateway"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Setup Complete!                         ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo "  Dashboard:  http://localhost:${OPENCLAW_GATEWAY_PORT:-18789}"
echo "  Ollama API: http://localhost:${OLLAMA_PORT:-11434}"
echo ""
echo "  Useful commands:"
echo "    docker compose logs -f                    # Watch logs"
echo "    docker compose exec ollama ollama list    # List models"
echo "    docker compose exec ollama ollama pull <model>  # Add model"
echo "    docker compose run --rm openclaw-cli configure  # Reconfigure"
echo "    docker compose down                       # Stop everything"
echo ""
echo "  To add channels:"
echo "    docker compose run --rm openclaw-cli channels add --channel discord --token \"TOKEN\""
echo "    docker compose run --rm openclaw-cli channels add --channel telegram --token \"TOKEN\""
echo "    docker compose run --rm openclaw-cli channels login  # WhatsApp QR"
echo ""
