# =============================================================================
# OpenClaw + Ollama Docker — Makefile
# =============================================================================
# Usage: make [target]

.PHONY: help setup up down restart logs status models pull-model onboard configure backup update clean agents-gen agents-up agents-down agents-logs agents-init

COMPOSE := docker compose
COMPOSE_AGENTS := docker compose -f docker-compose.yml -f docker-compose.agents.yml
PROFILE ?=

ifdef GPU
  PROFILE += --profile gpu
endif
ifdef PROXY
  PROFILE += --profile proxy
endif

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Setup & Lifecycle
# ---------------------------------------------------------------------------

setup: ## Run interactive setup (first time)
	@bash scripts/setup.sh

launch: ## Launch full experiment (usage: make launch [SPAWN=3])
	@bash scripts/launch-experiment.sh $(if $(SPAWN),--auto-spawn $(SPAWN),)

validate: ## Validate all configuration before launch
	@bash scripts/validate.sh

build: ## Build OpenClaw image from source
	docker build -t openclaw:local -f Dockerfile.openclaw .

up: ## Start all services
	$(COMPOSE) $(PROFILE) up -d

down: ## Stop all services
	$(COMPOSE) $(PROFILE) down

restart: ## Restart all services
	$(COMPOSE) $(PROFILE) restart

restart-gateway: ## Restart only the OpenClaw gateway
	$(COMPOSE) restart openclaw-gateway

# ---------------------------------------------------------------------------
# Monitoring
# ---------------------------------------------------------------------------

logs: ## Tail all logs
	$(COMPOSE) logs -f

logs-gateway: ## Tail OpenClaw gateway logs
	$(COMPOSE) logs -f openclaw-gateway

logs-ollama: ## Tail Ollama logs
	$(COMPOSE) logs -f ollama

status: ## Show service status
	$(COMPOSE) ps

# ---------------------------------------------------------------------------
# Ollama Models
# ---------------------------------------------------------------------------

models: ## List installed Ollama models
	$(COMPOSE) exec ollama ollama list

pull-model: ## Pull a model (usage: make pull-model MODEL=qwen3-coder)
	$(COMPOSE) --profile admin run --rm ollama-admin pull $(MODEL)

pull-standard: ## Pull standard model set
	@bash scripts/pull-models.sh --preset standard

pull-minimal: ## Pull minimal model set
	@bash scripts/pull-models.sh --preset minimal

pull-power: ## Pull power model set (large models)
	@bash scripts/pull-models.sh --preset power

# ---------------------------------------------------------------------------
# OpenClaw Management
# ---------------------------------------------------------------------------

onboard: ## Run OpenClaw onboarding wizard (needs internet temporarily)
	$(COMPOSE) run --rm --network openclaw-ollama-docker_egress openclaw-cli onboard

configure: ## Run OpenClaw configuration
	$(COMPOSE) run --rm openclaw-cli configure

dashboard: ## Get dashboard URL + token
	$(COMPOSE) run --rm openclaw-cli dashboard --no-open

cli: ## Open interactive OpenClaw CLI
	$(COMPOSE) run --rm openclaw-cli

shell: ## Open a shell in the gateway container
	$(COMPOSE) exec openclaw-gateway /bin/bash

# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------

setup-discord: ## Auto-setup Discord server (usage: make setup-discord TOKEN=xxx GUILD=xxx)
	@bash scripts/setup-discord-server.sh $(TOKEN) $(GUILD)

add-discord: ## Add Discord bot (usage: make add-discord TOKEN=xxx)
	$(COMPOSE) run --rm openclaw-cli channels add --channel discord --token "$(TOKEN)"

add-telegram: ## Add Telegram bot (usage: make add-telegram TOKEN=xxx)
	$(COMPOSE) run --rm openclaw-cli channels add --channel telegram --token "$(TOKEN)"

add-whatsapp: ## Login to WhatsApp via QR code
	$(COMPOSE) run --rm openclaw-cli channels login

# ---------------------------------------------------------------------------
# Maintenance
# ---------------------------------------------------------------------------

memory-status: ## Show agent memory file status
	@bash scripts/sync-memory.sh status

memory-backup: ## Backup all agent memories
	@bash scripts/sync-memory.sh backup

memory-restore: ## Restore agent memories from latest backup
	@bash scripts/sync-memory.sh restore

backup: ## Backup config and workspace
	@bash scripts/backup.sh

backup-full: ## Backup including Ollama models
	@bash scripts/backup.sh --include-models

update: ## Update OpenClaw and Ollama images
	$(COMPOSE) pull ollama
	docker build -t openclaw:local -f Dockerfile.openclaw --pull .
	$(COMPOSE) $(PROFILE) up -d

# ---------------------------------------------------------------------------
# Multi-Agent Management
# ---------------------------------------------------------------------------

agents-gen: ## Generate agent compose file from agents.yml
	@bash scripts/generate-compose.sh

agents-up: ## Start all agents + infrastructure
	$(COMPOSE_AGENTS) $(PROFILE) up -d

agents-down: ## Stop all agents + infrastructure
	$(COMPOSE_AGENTS) $(PROFILE) down

agents-restart: ## Restart all agents
	$(COMPOSE_AGENTS) $(PROFILE) restart

agents-logs: ## Tail all agent logs
	$(COMPOSE_AGENTS) logs -f

agents-init: ## Configure agents for a Discord server (usage: make agents-init GUILD=xxx [CHANNEL=yyy])
	@bash scripts/init-agents.sh $(GUILD) $(CHANNEL)

agents-status: ## Show status of all agent containers
	$(COMPOSE_AGENTS) ps

# ---------------------------------------------------------------------------
# Spawn Controller
# ---------------------------------------------------------------------------

spawn-status: ## Show spawn controller limits and usage
	@curl -sf http://localhost:9090/limits | jq .

spawn-list: ## List dynamically spawned agents
	@curl -sf http://localhost:9090/agents | jq .

spawn-agent: ## Spawn a new agent (usage: make spawn-agent NAME=xxx PERSONALITY="...")
	@curl -sf -X POST http://localhost:9090/agents \
		-H "Content-Type: application/json" \
		-d '{"name":"$(NAME)","personality":"$(PERSONALITY)","model":"$(MODEL)"}' | jq .

spawn-kill: ## Kill a spawned agent (usage: make spawn-kill NAME=xxx)
	@curl -sf -X DELETE http://localhost:9090/agents/$(NAME) | jq .

spawn-random: ## Spawn an agent with a random personality
	@curl -sf -X POST http://localhost:9090/agents/random -H "Content-Type: application/json" -d '{}' | jq .

random-preview: ## Preview a random agent personality (doesn't spawn)
	@curl -sf http://localhost:9090/random-agent | jq .

topic: ## Get a conversation starter topic
	@curl -sf http://localhost:9090/topics | jq .topic

topic-category: ## Get a topic from a category (usage: make topic-category CAT=debate)
	@curl -sf "http://localhost:9090/topics?category=$(CAT)" | jq .topic

token-list: ## List Discord bot tokens in pool
	@curl -sf http://localhost:9090/tokens | jq .

token-add: ## Add a Discord bot token (usage: make token-add TOKEN=xxx NAME=mybot)
	@curl -sf -X POST http://localhost:9090/tokens \
		-H "Content-Type: application/json" \
		-d '{"token":"$(TOKEN)","name":"$(NAME)"}' | jq .

token-remove: ## Remove a token (usage: make token-remove ID=tok_xxx)
	@curl -sf -X DELETE http://localhost:9090/tokens/$(ID) | jq .

dashboard: ## Open the monitoring dashboard
	@echo "Dashboard: http://localhost:$${CONTROLLER_PORT:-9090}/dashboard"

events: ## Stream live events from the controller
	@curl -sf -N http://localhost:9090/events

emergency-stop: ## Kill ALL spawned agents immediately
	@echo "⚠️  Killing all spawned agents..."
	@curl -sf -X POST http://localhost:9090/emergency-stop -H "Content-Type: application/json" | jq .

experiment-summary: ## Show experiment analytics summary
	@curl -sf http://localhost:9090/observe/summary | jq .

experiment-snapshot: ## Take a manual experiment snapshot
	@curl -sf -X POST http://localhost:9090/observe/snapshot | jq .

transcript: ## Export experiment transcript (usage: make transcript [FMT=markdown] [OUT=file.md])
	@bash scripts/export-transcript.sh $(if $(FMT),--format $(FMT),) $(if $(OUT),--output $(OUT),)

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

clean: ## Remove all containers and volumes (DESTRUCTIVE)
	@echo "This will delete ALL data including models and config."
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	$(COMPOSE) $(PROFILE) down -v
	rm -rf data/
