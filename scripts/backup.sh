#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Backup OpenClaw config, workspace, and optionally Ollama models
# Usage: ./scripts/backup.sh [--include-models]
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

source .env 2>/dev/null || true

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="./backups"
BACKUP_FILE="$BACKUP_DIR/openclaw-backup-$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

INCLUDE_MODELS=false
if [ "${1:-}" = "--include-models" ]; then
  INCLUDE_MODELS=true
fi

echo "Creating backup: $BACKUP_FILE"

BACKUP_PATHS=(
  "${OPENCLAW_CONFIG_DIR:-./data/openclaw-config}"
  "${OPENCLAW_WORKSPACE_DIR:-./data/openclaw-workspace}"
  ".env"
)

if [ "$INCLUDE_MODELS" = true ]; then
  echo "Including Ollama models (this may be large)..."
  BACKUP_PATHS+=("${OLLAMA_DATA_DIR:-./data/ollama-models}")
fi

tar -czf "$BACKUP_FILE" "${BACKUP_PATHS[@]}" 2>/dev/null || {
  echo "Warning: Some files may have been skipped"
}

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "✓ Backup complete: $BACKUP_FILE ($SIZE)"

# Keep only last 5 backups
ls -t "$BACKUP_DIR"/openclaw-backup-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm
echo "  (keeping last 5 backups)"
