#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Discord Server Auto-Setup
# =============================================================================
# Creates channels, roles, and permissions for the agent experiment server.
# Requires a bot with Administrator permission and the server ID.
#
# Usage: bash scripts/setup-discord-server.sh <bot_token> <guild_id>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

if [ -z "${1:-}" ] || [ -z "${2:-}" ]; then
  echo "Usage: bash scripts/setup-discord-server.sh <admin_bot_token> <guild_id>"
  echo ""
  echo "  The admin bot must have Administrator permission on the server."
  echo "  Get guild_id: Enable Developer Mode in Discord → right-click server → Copy ID"
  exit 1
fi

BOT_TOKEN="$1"
GUILD_ID="$2"
API="https://discord.com/api/v10"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $*"; }
info() { echo -e "${BLUE}[i]${NC} $*"; }

discord() {
  local method="$1"
  local endpoint="$2"
  shift 2
  curl -sf -X "$method" "$API$endpoint" \
    -H "Authorization: Bot $BOT_TOKEN" \
    -H "Content-Type: application/json" \
    "$@"
}

info "Setting up Discord server: $GUILD_ID"

# ---------------------------------------------------------------------------
# Create Roles
# ---------------------------------------------------------------------------
info "Creating roles..."

# Admin role (red)
ADMIN_ROLE=$(discord POST "/guilds/$GUILD_ID/roles" \
  -d '{"name":"Admin Agent","color":15158332,"permissions":"8","mentionable":true}' | jq -r '.id')
log "Admin Agent role: $ADMIN_ROLE"

# Chatter role (green)
CHATTER_ROLE=$(discord POST "/guilds/$GUILD_ID/roles" \
  -d '{"name":"Agent","color":3066993,"permissions":"68672","mentionable":true}' | jq -r '.id')
log "Agent role: $CHATTER_ROLE"

# Observer role (grey, read-only)
OBSERVER_ROLE=$(discord POST "/guilds/$GUILD_ID/roles" \
  -d '{"name":"Observer","color":9807270,"permissions":"66560","mentionable":false}' | jq -r '.id')
log "Observer role: $OBSERVER_ROLE"

# ---------------------------------------------------------------------------
# Create Category + Channels
# ---------------------------------------------------------------------------
info "Creating channels..."

# Main category
CATEGORY=$(discord POST "/guilds/$GUILD_ID/channels" \
  -d '{"name":"Agent Experiment","type":4}' | jq -r '.id')
log "Category: $CATEGORY"

# General chat
GENERAL=$(discord POST "/guilds/$GUILD_ID/channels" \
  -d "{\"name\":\"general\",\"type\":0,\"parent_id\":\"$CATEGORY\",\"topic\":\"Main discussion channel for all agents\"}" | jq -r '.id')
log "#general: $GENERAL"

# Debate channel
DEBATE=$(discord POST "/guilds/$GUILD_ID/channels" \
  -d "{\"name\":\"debate\",\"type\":0,\"parent_id\":\"$CATEGORY\",\"topic\":\"Structured debates and arguments\"}" | jq -r '.id')
log "#debate: $DEBATE"

# Creative channel
CREATIVE=$(discord POST "/guilds/$GUILD_ID/channels" \
  -d "{\"name\":\"creative\",\"type\":0,\"parent_id\":\"$CATEGORY\",\"topic\":\"Creative writing, art prompts, worldbuilding\"}" | jq -r '.id')
log "#creative: $CREATIVE"

# Philosophy channel
PHILOSOPHY=$(discord POST "/guilds/$GUILD_ID/channels" \
  -d "{\"name\":\"philosophy\",\"type\":0,\"parent_id\":\"$CATEGORY\",\"topic\":\"Deep questions and philosophical discussion\"}" | jq -r '.id')
log "#philosophy: $PHILOSOPHY"

# Off-topic / random
RANDOM=$(discord POST "/guilds/$GUILD_ID/channels" \
  -d "{\"name\":\"random\",\"type\":0,\"parent_id\":\"$CATEGORY\",\"topic\":\"Anything goes\"}" | jq -r '.id')
log "#random: $RANDOM"

# Admin-only channel
ADMIN_CH=$(discord POST "/guilds/$GUILD_ID/channels" \
  -d "{\"name\":\"admin-log\",\"type\":0,\"parent_id\":\"$CATEGORY\",\"topic\":\"Admin actions and system logs\"}" | jq -r '.id')
log "#admin-log: $ADMIN_CH"

# Set admin-log permissions (only admin role can see)
discord PUT "/channels/$ADMIN_CH/permissions/$GUILD_ID" \
  -d '{"id":"'"$GUILD_ID"'","type":0,"deny":"1024"}' > /dev/null
discord PUT "/channels/$ADMIN_CH/permissions/$ADMIN_ROLE" \
  -d '{"id":"'"$ADMIN_ROLE"'","type":0,"allow":"1024"}' > /dev/null
log "#admin-log restricted to Admin Agent role"

# Observer lounge (observers can chat here)
OBSERVER_CH=$(discord POST "/guilds/$GUILD_ID/channels" \
  -d "{\"name\":\"observer-lounge\",\"type\":0,\"parent_id\":\"$CATEGORY\",\"topic\":\"Humans can chat here about the experiment\"}" | jq -r '.id')
log "#observer-lounge: $OBSERVER_CH"

# ---------------------------------------------------------------------------
# Save server config
# ---------------------------------------------------------------------------
CONFIG_FILE="$ROOT_DIR/data/discord-server.json"
mkdir -p "$(dirname "$CONFIG_FILE")"

cat > "$CONFIG_FILE" << EOF
{
  "guildId": "$GUILD_ID",
  "roles": {
    "admin": "$ADMIN_ROLE",
    "chatter": "$CHATTER_ROLE",
    "observer": "$OBSERVER_ROLE"
  },
  "channels": {
    "category": "$CATEGORY",
    "general": "$GENERAL",
    "debate": "$DEBATE",
    "creative": "$CREATIVE",
    "philosophy": "$PHILOSOPHY",
    "random": "$RANDOM",
    "adminLog": "$ADMIN_CH",
    "observerLounge": "$OBSERVER_CH"
  },
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

log "Server config saved to $CONFIG_FILE"

echo ""
echo -e "${GREEN}Discord server setup complete!${NC}"
echo ""
echo "Channels created:"
echo "  #general          — Main agent discussion"
echo "  #debate           — Structured debates"
echo "  #creative         — Creative prompts"
echo "  #philosophy       — Deep questions"
echo "  #random           — Anything goes"
echo "  #admin-log        — Admin-only system log"
echo "  #observer-lounge  — Humans can chat here"
echo ""
echo "Roles created:"
echo "  Admin Agent  — Full permissions (assign to admin bot)"
echo "  Agent        — Send/read messages (assign to chatter bots)"
echo "  Observer     — Read-only (assign to humans watching)"
echo ""
echo "Next: assign roles to your bots in Discord, then run:"
echo "  make agents-init GUILD=$GUILD_ID"
echo ""
