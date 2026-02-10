#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Sync Agent Memory
# =============================================================================
# Ensures agent memory files persist across container recreations.
# Copies MEMORY.md and memory/ between the host data dir and containers.
#
# Usage:
#   bash scripts/sync-memory.sh backup    # Container → Host
#   bash scripts/sync-memory.sh restore   # Host → Container (after recreate)
#   bash scripts/sync-memory.sh status    # Show memory file sizes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

ACTION="${1:-status}"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $*"; }
info() { echo -e "${BLUE}[i]${NC} $*"; }

case "$ACTION" in
  backup)
    info "Backing up agent memories..."
    for agent_dir in data/agents/*/; do
      name=$(basename "$agent_dir")
      ws="$agent_dir/workspace"
      
      if [ -f "$ws/MEMORY.md" ]; then
        SIZE=$(du -h "$ws/MEMORY.md" | cut -f1)
        log "$name: MEMORY.md ($SIZE)"
      fi
      
      if [ -d "$ws/memory" ]; then
        COUNT=$(find "$ws/memory" -name "*.md" 2>/dev/null | wc -l)
        log "$name: memory/ ($COUNT files)"
      fi
    done
    
    # Create timestamped backup
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    BACKUP="data/memory-backups/$TIMESTAMP"
    mkdir -p "$BACKUP"
    
    for agent_dir in data/agents/*/; do
      name=$(basename "$agent_dir")
      ws="$agent_dir/workspace"
      mkdir -p "$BACKUP/$name"
      
      [ -f "$ws/MEMORY.md" ] && cp "$ws/MEMORY.md" "$BACKUP/$name/"
      [ -d "$ws/memory" ] && cp -r "$ws/memory" "$BACKUP/$name/"
    done
    
    log "Backup saved to $BACKUP"
    
    # Keep only last 10 backups
    ls -dt data/memory-backups/*/ 2>/dev/null | tail -n +11 | xargs -r rm -rf
    ;;
    
  restore)
    info "Restoring agent memories from latest backup..."
    LATEST=$(ls -dt data/memory-backups/*/ 2>/dev/null | head -1)
    
    if [ -z "$LATEST" ]; then
      echo "No backups found in data/memory-backups/"
      exit 1
    fi
    
    info "Using backup: $LATEST"
    
    for backup_dir in "$LATEST"/*/; do
      name=$(basename "$backup_dir")
      ws="data/agents/$name/workspace"
      
      if [ ! -d "$ws" ]; then
        info "Skipping $name (no agent directory)"
        continue
      fi
      
      [ -f "$backup_dir/MEMORY.md" ] && cp "$backup_dir/MEMORY.md" "$ws/" && log "$name: MEMORY.md restored"
      [ -d "$backup_dir/memory" ] && cp -r "$backup_dir/memory" "$ws/" && log "$name: memory/ restored"
    done
    ;;
    
  status)
    echo "Agent Memory Status:"
    echo ""
    
    for agent_dir in data/agents/*/; do
      name=$(basename "$agent_dir")
      ws="$agent_dir/workspace"
      
      echo "  $name:"
      
      if [ -f "$ws/MEMORY.md" ]; then
        SIZE=$(du -h "$ws/MEMORY.md" | cut -f1)
        LINES=$(wc -l < "$ws/MEMORY.md")
        echo "    MEMORY.md: $SIZE, $LINES lines"
      else
        echo "    MEMORY.md: (none)"
      fi
      
      if [ -d "$ws/memory" ]; then
        COUNT=$(find "$ws/memory" -name "*.md" 2>/dev/null | wc -l)
        SIZE=$(du -sh "$ws/memory" 2>/dev/null | cut -f1)
        echo "    memory/: $COUNT files, $SIZE"
      else
        echo "    memory/: (none)"
      fi
      
      echo ""
    done
    
    BACKUP_COUNT=$(ls -d data/memory-backups/*/ 2>/dev/null | wc -l)
    echo "  Backups: $BACKUP_COUNT"
    ;;
    
  *)
    echo "Usage: bash scripts/sync-memory.sh [backup|restore|status]"
    exit 1
    ;;
esac
