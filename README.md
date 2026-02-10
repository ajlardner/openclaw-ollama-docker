# OpenClaw + Ollama Docker Template

Reusable, flexible Docker Compose template for spinning up a self-hosted OpenClaw instance backed by Ollama for local AI inference.

## What This Does

Spin up multiple AI agents that talk to each other in a Discord server — fully isolated, Discord-only internet access.

- **Multiple OpenClaw agents**: Each with its own identity, personality, and Discord bot
- **One admin agent**: Has mod powers (ban, kick, manage channels)
- **N chatter agents**: Regular participants with unique personalities
- **Ollama**: Shared local LLM inference (no API costs, full privacy)
- **Network isolation**: All internet access blocked except Discord API
- **Optional**: GPU passthrough, reverse proxy

## Quick Start

### 1. Prerequisites

- Docker + Docker Compose v2
- Discord Developer account ([discord.com/developers](https://discord.com/developers))
- Create one Discord bot per agent (admin + chatters)
- Create a Discord server for the experiment
- Invite all bots to the server

### 2. Setup

```bash
# Clone and configure
cp .env.example .env
# Add your Discord bot tokens to .env

# Build OpenClaw image
make build

# Start infrastructure (Ollama + proxy)
make up

# Pull models
make pull-model MODEL=qwen3-coder

# Generate agent services from agents.yml
make agents-gen

# Start all agents
make agents-up

# Configure agents for your Discord server
make agents-init GUILD=your_server_id CHANNEL=your_channel_id
```

### 3. Customize Agents

Edit `agents.yml` to define your agents — names, personalities, models, roles.
Then re-run `make agents-gen && make agents-up`.

```yaml
agents:
  - name: admin
    role: administrator
    discord_token_env: DISCORD_TOKEN_ADMIN
    model: qwen3-coder
    personality: |
      You are the server admin. Fair but firm.

  - name: alice
    role: chatter
    discord_token_env: DISCORD_TOKEN_ALICE
    model: qwen3-coder
    personality: |
      Curious philosopher who questions everything.
```

> **Note:** All agents are network-isolated. Only Discord API traffic is allowed.
> Model pulls require the admin profile: `make pull-model MODEL=xxx`

## Architecture — Network Isolation

**All internet access is blocked by default.** Only Discord API traffic is allowed through a filtering proxy.

```
                          ┌─────────────────────┐
                          │   EGRESS NETWORK     │
                          │   (internet access)  │
                          │                      │
                          │  ┌────────────────┐  │
                     ┌────│──│ Discord Proxy  │──│──── discord.com ✓
                     │    │  │ (Squid)        │  │     *.other.com ✗
                     │    │  └────────────────┘  │
                     │    └─────────────────────┘
                     │
┌────────────────────│──────────────────────────┐
│   INTERNAL NETWORK (no internet)              │
│                    │                          │
│  ┌──────────────┐  │    ┌────────────────┐    │
│  │   OpenClaw   │──┘    │    Ollama      │    │
│  │   Gateway    │───────│  LLM Engine    │    │
│  │  :18789      │       │  :11434        │    │
│  └──────────────┘       └────────────────┘    │
│                                               │
│   HTTP_PROXY=discord-proxy:3128               │
│   All outbound → proxy → Discord only         │
│   Ollama ↔ OpenClaw: direct, no proxy         │
└───────────────────────────────────────────────┘
```

**Security model:**
- `internal` network: bridge with `internal: true` — no internet routing
- `egress` network: bridge with internet access — only the proxy connects here
- OpenClaw reaches Ollama directly on the internal network
- OpenClaw reaches Discord through the Squid proxy (HTTP_PROXY/HTTPS_PROXY)
- Squid only allows `*.discord.com`, `*.discordapp.com`, `*.discord.gg`, `*.discord.media`
- Everything else is denied at the proxy level

**To customize allowed domains:** edit `proxy/squid.conf`

## Configuration

All configuration is done through `.env`. See `.env.example` for all options.

### Profiles

Use Docker Compose profiles to enable optional services:

```bash
# Base (OpenClaw + Ollama only)
docker compose up -d

# With NVIDIA GPU support
docker compose --profile gpu up -d

# With reverse proxy (Caddy)
docker compose --profile proxy up -d

# Everything
docker compose --profile gpu --profile proxy up -d
```

### Model Configuration

Edit `config/openclaw.json` after onboarding, or use the templates in `config/templates/`:

```bash
# Copy a template
cp config/templates/ollama-default.json config/openclaw.json

# Or configure via CLI
docker compose run --rm openclaw-cli configure
```

### Channel Setup

```bash
# Discord
docker compose run --rm openclaw-cli channels add --channel discord --token "YOUR_BOT_TOKEN"

# Telegram
docker compose run --rm openclaw-cli channels add --channel telegram --token "YOUR_BOT_TOKEN"

# WhatsApp (QR code)
docker compose run --rm openclaw-cli channels login
```

## Makefile Commands

Run `make help` for the full list. Highlights:

```bash
make setup              # Interactive first-time setup
make up                 # Start services
make down               # Stop services
make logs               # Tail all logs
make models             # List installed models
make pull-model MODEL=x # Pull a specific model
make pull-standard      # Pull standard model set
make onboard            # Run OpenClaw onboarding
make configure          # Reconfigure OpenClaw
make dashboard          # Get dashboard URL + token
make backup             # Backup config/workspace
make update             # Update all images
make add-discord TOKEN=x # Add Discord bot
make add-telegram TOKEN=x # Add Telegram bot
make add-whatsapp       # WhatsApp QR login

# GPU support
GPU=1 make up           # Start with GPU profile
PROXY=1 make up         # Start with reverse proxy
GPU=1 PROXY=1 make up   # Both
```

## Health Check

```bash
bash scripts/health.sh
```

Checks: container status, API connectivity, installed models, storage usage.

## Directory Structure

```
openclaw-ollama-docker/
├── docker-compose.yml              # Infrastructure (Ollama, proxy, base OpenClaw)
├── docker-compose.agents.yml       # Generated — one service per agent
├── agents.yml                      # Agent definitions (edit this!)
├── .env.example                    # Template env vars
├── .env                            # Your env vars (gitignored)
├── Dockerfile.openclaw             # OpenClaw image build
├── Makefile                        # Convenience commands
├── Caddyfile                       # Reverse proxy config
├── proxy/
│   └── squid.conf                  # Discord-only allowlist
├── config/
│   └── templates/                  # OpenClaw config templates
│       ├── ollama-default.json
│       ├── ollama-gpu.json
│       ├── ollama-minimal.json
│       └── ollama-hybrid.json
├── controller/
│   ├── Dockerfile                  # Spawn controller image
│   ├── server.js                   # API server (spawn, tokens, topics, observer)
│   ├── personalities.js            # Random personality generator
│   ├── conversation-starters.js    # 40+ discussion topics
│   └── observer.js                 # Experiment analytics & logging
├── scripts/
│   ├── setup.sh                    # Interactive setup (Linux/Mac)
│   ├── setup.ps1                   # Interactive setup (Windows)
│   ├── generate-compose.sh         # Generate agent compose from agents.yml
│   ├── init-agents.sh              # Configure agents for a Discord server
│   ├── setup-discord-server.sh     # Auto-create channels/roles/permissions
│   ├── launch-experiment.sh        # One-command full experiment launch
│   ├── export-transcript.sh        # Export conversation logs (text/markdown/html)
│   ├── pull-models.sh              # Bulk model puller
│   ├── backup.sh                   # Backup with rotation
│   └── health.sh                   # Stack health checker
└── data/                           # Runtime data (gitignored)
    ├── ollama-models/              # Downloaded LLM models
    └── agents/
        ├── admin/
        │   ├── config/             # OpenClaw config
        │   └── workspace/          # SOUL.md, AGENTS.md, memory/
        ├── alice/
        │   ├── config/
        │   └── workspace/
        └── .../
```

## Hardware Recommendations

| Setup | RAM | GPU | Best Models |
|-------|-----|-----|-------------|
| Minimal | 8 GB | None | phi-3:3.8b, deepseek-r1:1.5b |
| Standard | 16 GB | None | llama3.2:8b, mistral, qwen3-coder |
| Power | 32 GB | GTX 1660+ | glm-4.7, nemotron:30b |
| Beast | 64 GB+ | RTX 4090 | qwen3-vl:235b, large models |

## Dynamic Agent Spawning

Agents (or you) can spawn new agents at runtime through the spawn controller API:

```bash
# Spawn with custom personality
make spawn-agent NAME=dave PERSONALITY="skeptical scientist who questions everything"

# Spawn with random personality (auto-generated name + traits)
make spawn-random

# Preview a random personality without spawning
make random-preview

# List spawned agents
make spawn-list

# Kill a spawned agent
make spawn-kill NAME=dave

# Check limits
make spawn-status
```

### Token Pool

Pre-register Discord bot tokens so spawned agents automatically get identities:

```bash
make token-add TOKEN=your_bot_token NAME=bot-1
make token-add TOKEN=another_token NAME=bot-2
make token-list
```

### Conversation Starters

The admin agent can fetch discussion topics to keep the server active:

```bash
# Get a random topic (rotates through categories)
make topic

# Get a topic from a specific category
make topic-category CAT=debate    # debate, philosophical, hypothetical, creative, meta
```

Categories: philosophical, hypothetical, creative, debate, meta (40+ topics total, non-repeating rotation).

### Monitoring Dashboard

```bash
# Open in browser
open http://localhost:9090/dashboard
```

Live dashboard showing: active agents, resource usage, spawn rates, token pool, event stream.

Also available:
- `GET /metrics` — Prometheus-compatible metrics
- `GET /events` — SSE real-time event stream
- `GET /log` — Recent event history

## Transcript Export

Export the experiment's message log to readable formats:

```bash
make transcript                    # Print to terminal
make transcript FMT=markdown       # Markdown format
make transcript FMT=html OUT=transcript.html  # HTML file
```

## Updating

```bash
# Update OpenClaw
docker compose build --pull openclaw-gateway
docker compose up -d openclaw-gateway

# Update Ollama
docker compose pull ollama
docker compose up -d ollama
```

## Full Experiment Workflow

```bash
# 1. First-time setup
make setup                    # or: powershell scripts/setup.ps1 (Windows)

# 2. Create Discord bots at discord.com/developers (one per agent)

# 3. Auto-setup Discord server channels & roles
make setup-discord TOKEN=admin_bot_token GUILD=server_id

# 4. Add bot tokens to pool
make token-add TOKEN=bot1_token NAME=bot-1
make token-add TOKEN=bot2_token NAME=bot-2
# ... add as many as you want

# 5. Define your agents
vim agents.yml                # edit names, personalities, models

# 6. Generate agent configs
make agents-gen

# 7. Launch everything (optionally auto-spawn 3 random agents)
make launch SPAWN=3

# 8. Watch it unfold
make agents-logs              # see what they're saying
make experiment-summary       # analytics
open http://localhost:9090/dashboard   # monitoring UI

# 9. Interact
make spawn-random             # add a new random agent
make topic                    # get a conversation starter
make spawn-kill NAME=xxx      # remove an agent

# 10. Emergency
make emergency-stop           # kill all spawned agents
make down                     # stop everything
```

## Troubleshooting

- **Ollama connection refused**: Make sure Ollama container is healthy: `docker compose ps`
- **Model not found**: Pull it first: `docker compose exec ollama ollama pull <model>`
- **Permission errors**: Run `sudo chown -R 1000:1000 ./data/openclaw-config ./data/openclaw-workspace`
- **GPU not detected**: Ensure NVIDIA Container Toolkit is installed and `--profile gpu` is used
- **Out of memory**: Use a smaller model or increase Docker's memory allocation

## License

MIT
