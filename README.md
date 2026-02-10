# WWE Discord Agent Experiment 🤼

AI-powered WWE wrestlers that interact, feud, and put on shows in a Discord server. One bot, unlimited characters via webhooks. Local LLM inference via Ollama.

## What This Does

Drop 7 AI WWE wrestlers into a Discord channel. They trash talk, form alliances, betray each other, have simulated matches, and put on full Pay-Per-View events — all autonomously.

**Characters:** John Cena 🎺 · The Rock 🪨 · Stone Cold 💀 · Undertaker ⚰️ · Macho Man 🕶️ · Triple H 👑 · Mankind 🎭

**Announcers:** Jim Ross 🤠 · Jerry "The King" Lawler 👑

## Architecture

```
Discord Server
    │
    ▼
[One Discord Bot] → reads messages → [Director Service]
                                          │
                    ┌─────────────────────┤
                    ▼                     ▼
            [Storyline Engine]    [Match Engine]
            feuds, heat,         simulations,
            surprises            round-by-round
                    │                     │
                    └──────┬──────────────┘
                           ▼
                     [Ollama LLM]
                           │
                           ▼
                  [Discord Webhooks]
                  (posts as characters
                   with name + avatar)
```

## Features

### 🎭 Character System
- 7 fully-realized WWE personas with unique speech patterns, catchphrases, feuds
- Response probability based on personality (Undertaker rarely speaks; Macho Man never shuts up)
- Heat tracking prevents one character from dominating

### 🔥 Storyline Engine
- Dynamic feud system with intensity tracking (1-10 scale)
- Surprise entrances (characters waiting "in the wings")
- Scheduled promos at configurable intervals
- Storyline beat selection: trash-talk, challenges, mind games, betrayals, alliances
- Full state persistence across restarts

### 🤼 Match Simulation
- Match types: Singles, No-DQ, Steel Cage, Hell in a Cell, Ladder, Triple Threat
- Phased rounds: early (lock-ups) → mid (signature moves) → late (finishers) → finish
- Momentum + damage tracking with weighted outcomes
- Fair results (verified with 100-match statistical tests)
- Matches broadcast to Discord with dramatic pacing

### 🏆 Championship System
- 4 titles: WWE Championship, Intercontinental, Tag Team, Hardcore
- Title matches auto-award belts to winners
- Champions reference their gold in character responses
- Defense tracking and full title history

### 🎆 Pay-Per-View Events
- 8 PPV templates: WrestleMania, SummerSlam, Royal Rumble, Survivor Series, Hell in a Cell, Money in the Bank, TLC, Elimination Chamber
- Auto-book match cards from active feuds + championship holders
- Full PPV runner: pre-show hype → entrances → sequential matches → results summary
- Title matches during PPVs auto-update championship state

### 🎙️ Announcer Commentary
- JR and Jerry Lawler react to surprise entrances, title changes, betrayals
- Event-specific trigger probabilities (JR at 90% for surprise entrances, 100% for title changes)
- Posts via webhook with their own names/avatars

### 📊 Live Control Dashboard
Web UI at `http://localhost:9091/dashboard`:
- Roster management (activate/deactivate wrestlers)
- Create feuds with intensity sliders
- Force promos from any character
- Book and run matches
- Schedule and trigger PPV events
- Award/vacate championship belts
- Live chat log
- Real-time stats (active wrestlers, feuds, messages)

## Quick Start

### Prerequisites
- Docker + Docker Compose v2
- One Discord bot token ([discord.com/developers](https://discord.com/developers))
- One Discord webhook (Channel Settings → Integrations → Webhooks)

### Setup

```bash
cp .env.example .env
# Edit .env with your Discord credentials:
#   DISCORD_BOT_TOKEN=...
#   DISCORD_GUILD_ID=...
#   DISCORD_CHANNEL_ID=...
#   DISCORD_WEBHOOK_URL=...

# Start everything
make wwe-up

# Dashboard at http://localhost:9091/dashboard
```

### What Happens
1. Director service starts, loads storyline state
2. Bot connects to Discord, watches for messages in the configured channel
3. Characters respond based on personality, feuds, and heat
4. Surprise entrances happen organically
5. Promos fire on schedule
6. Use the dashboard to book matches and PPV events

## Files

```
director/
  index.js              — Main director service + dashboard
  characters.js         — 7 WWE character profiles
  storyline-engine.js   — Feud/surprise/promo management
  match-engine.js       — Match simulation (37 tests passing)
  championships.js      — Title tracking system
  ppv-engine.js         — Pay-Per-View event system
  announcers.js         — JR + Lawler commentary system
  test-match-engine.js  — Test suite
  Dockerfile            — Director container

controller/
  server.js             — Legacy spawn controller
  conversation-starters.js
  personalities.js
  rate-limiter.js

config/                 — Ollama model configs
scripts/                — Setup + maintenance scripts
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/state` | Current storyline state |
| GET | `/characters` | Full roster with status |
| GET | `/championships` | All title holders |
| GET | `/matches` | Match history + active match |
| GET | `/ppv` | PPV schedule + history |
| GET | `/history?limit=N` | Recent chat messages |
| POST | `/pause` | Pause all character responses |
| POST | `/resume` | Resume responses |
| POST | `/speak` | Force a character to speak |
| POST | `/surprise` | Trigger surprise entrance |
| POST | `/feud` | Create/update a feud |
| POST | `/characters` | Activate/deactivate character |
| POST | `/championships/award` | Award a title |
| POST | `/championships/vacate` | Vacate a title |
| POST | `/matches/simulate` | Run a full match |
| POST | `/ppv/schedule` | Schedule a PPV event |
| POST | `/ppv/:id/add-match` | Add match to PPV card |
| POST | `/ppv/:id/auto-book` | Auto-generate match card |
| POST | `/ppv/:id/run` | Run the PPV live |
| GET | `/dashboard` | Live control dashboard |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `DISCORD_GUILD_ID` | Yes | Discord server ID |
| `DISCORD_CHANNEL_ID` | Yes | Target channel ID |
| `DISCORD_WEBHOOK_URL` | Yes | Channel webhook URL |
| `OLLAMA_URL` | No | Ollama endpoint (default: `http://ollama:11434`) |
| `OLLAMA_MODEL` | No | Model name (default: `qwen3-coder`) |
| `DIRECTOR_PORT` | No | API port (default: `9091`) |
| `RESPONSE_DELAY_MS` | No | Base delay before responding (default: `3000`) |
| `PROMO_INTERVAL_MIN` | No | Minutes between scheduled promos (default: `30`) |
| `MAX_RESPONSE_LENGTH` | No | Max character response length (default: `500`) |

## Testing

```bash
node director/test-match-engine.js
# 37 tests, includes 100-match fairness verification
```

## License

MIT
