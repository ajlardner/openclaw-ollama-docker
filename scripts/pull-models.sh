#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Pull multiple Ollama models in bulk
# Usage: ./scripts/pull-models.sh [model1] [model2] ...
#        ./scripts/pull-models.sh --preset minimal|standard|power|all
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

MINIMAL_MODELS="phi:3.8b deepseek-r1:1.5b"
STANDARD_MODELS="qwen3-coder glm-4.7 mistral llama3.2:8b"
POWER_MODELS="$STANDARD_MODELS nemotron-3-nano:30b qwen3-vl:235b nomic-embed-text"

if [ "${1:-}" = "--preset" ]; then
  case "${2:-standard}" in
    minimal)  MODELS="$MINIMAL_MODELS" ;;
    standard) MODELS="$STANDARD_MODELS" ;;
    power)    MODELS="$POWER_MODELS" ;;
    all)      MODELS="$MINIMAL_MODELS $STANDARD_MODELS $POWER_MODELS" ;;
    *)        echo "Unknown preset: $2"; echo "Options: minimal, standard, power, all"; exit 1 ;;
  esac
elif [ $# -gt 0 ]; then
  MODELS="$*"
else
  # Read from .env
  source .env 2>/dev/null || true
  MODELS="${OLLAMA_MODELS:-qwen3-coder}"
fi

echo "Pulling models: $MODELS"
echo ""

for model in $MODELS; do
  echo "==> Pulling $model..."
  docker compose exec ollama ollama pull "$model"
  echo "    ✓ $model ready"
  echo ""
done

echo "Done! Installed models:"
docker compose exec ollama ollama list
