#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Initialize agent Discord channels after bots are running
# =============================================================================
# Run this after all agents are up to configure their Discord channel access.
# 
# Usage: bash scripts/init-agents.sh <guild_id> [channel_id]
#
# If no channel_id given, agents will listen to all channels in the guild.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

if [ -z "${1:-}" ]; then
  echo "Usage: bash scripts/init-agents.sh <discord_guild_id> [channel_id]"
  echo ""
  echo "  guild_id:   Your experiment Discord server ID"
  echo "  channel_id: (optional) Specific channel to restrict agents to"
  echo ""
  echo "  Get IDs: Enable Developer Mode in Discord → right-click → Copy ID"
  exit 1
fi

GUILD_ID="$1"
CHANNEL_ID="${2:-}"

if ! command -v yq &>/dev/null; then
  echo "Error: yq is required. Run: bash scripts/generate-compose.sh (it installs yq)"
  exit 1
fi

AGENTS_FILE="agents.yml"
AGENT_COUNT=$(yq '.agents | length' "$AGENTS_FILE")

for i in $(seq 0 $((AGENT_COUNT - 1))); do
  NAME=$(yq ".agents[$i].name" "$AGENTS_FILE")
  ROLE=$(yq ".agents[$i].role" "$AGENTS_FILE")
  CONFIG="data/agents/$NAME/config/openclaw.json"

  if [ ! -f "$CONFIG" ]; then
    echo "Warning: $CONFIG not found, skipping $NAME"
    continue
  fi

  echo "Configuring Discord for agent: $NAME ($ROLE)"

  # Build guild config based on role
  if [ "$ROLE" = "administrator" ]; then
    REQUIRE_MENTION="false"
  else
    REQUIRE_MENTION="false"
  fi

  if [ -n "$CHANNEL_ID" ]; then
    # Restrict to specific channel
    GUILD_CONFIG="{\"channels\":{\"${CHANNEL_ID}\":{\"allow\":true,\"requireMention\":${REQUIRE_MENTION}}}}"
  else
    # Allow all channels in guild (requireMention at guild level)
    GUILD_CONFIG="{\"channels\":{}}"
  fi

  # Update the config with jq or python
  if command -v jq &>/dev/null; then
    TMP=$(mktemp)
    jq --arg gid "$GUILD_ID" --argjson gc "$GUILD_CONFIG" \
      '.channels.discord.guilds[$gid] = $gc' "$CONFIG" > "$TMP"
    mv "$TMP" "$CONFIG"
  else
    # Fallback: python
    python3 -c "
import json, sys
with open('$CONFIG') as f:
    cfg = json.load(f)
cfg.setdefault('channels', {}).setdefault('discord', {})['guilds'] = {
    '$GUILD_ID': json.loads('$GUILD_CONFIG')
}
with open('$CONFIG', 'w') as f:
    json.dump(cfg, f, indent=2)
"
  fi

  echo "  ✓ $NAME → guild $GUILD_ID"
done

echo ""
echo "Done! Restart agents to pick up changes:"
echo "  docker compose -f docker-compose.yml -f docker-compose.agents.yml restart"
