/**
 * OpenClaw Spawn Controller
 * 
 * Lightweight API that manages agent container lifecycle with hard limits.
 * Agents call this to spawn new agents — they never touch Docker directly.
 * 
 * Endpoints:
 *   POST   /agents              — Spawn a new agent
 *   GET    /agents              — List running agents
 *   DELETE /agents/:name        — Kill an agent
 *   GET    /agents/:name        — Get agent status
 *   GET    /limits              — Show current limits and usage
 *   POST   /agents/:name/restart — Restart an agent
 *   GET    /tokens              — List token pool status
 *   POST   /tokens              — Add a token to the pool
 *   DELETE /tokens/:id          — Remove a token from the pool
 *   GET    /metrics             — Prometheus-style metrics
 *   GET    /dashboard           — Simple HTML monitoring dashboard
 *   GET    /events              — SSE event stream
 */

import Docker from 'dockerode';
import express from 'express';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomName, randomPersonality, generateAgent } from './personalities.js';
import { ConversationStarter } from './conversation-starters.js';
import { Observer } from './observer.js';
import { RateLimiter } from './rate-limiter.js';

const app = express();
app.use(express.json());

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ---------------------------------------------------------------------------
// Configuration (from environment)
// ---------------------------------------------------------------------------
const CONFIG = {
  // Hard limits
  maxAgents:        parseInt(process.env.MAX_AGENTS || '10'),
  maxCpuPerAgent:   parseFloat(process.env.MAX_CPU_PER_AGENT || '1.0'),
  maxMemPerAgent:   parseInt(process.env.MAX_MEM_PER_AGENT || '512'),
  maxTotalMem:      parseInt(process.env.MAX_TOTAL_MEM || '4096'),
  
  // Rate limiting
  spawnCooldownSec: parseInt(process.env.SPAWN_COOLDOWN_SEC || '30'),
  maxSpawnsPerHour: parseInt(process.env.MAX_SPAWNS_PER_HOUR || '10'),
  
  // Auto-cleanup
  idleTimeoutMin:   parseInt(process.env.IDLE_TIMEOUT_MIN || '60'),       // Kill agents idle for this long (0 = disabled)
  cleanupIntervalSec: parseInt(process.env.CLEANUP_INTERVAL_SEC || '60'), // Check interval
  
  // Network
  internalNetwork:  process.env.INTERNAL_NETWORK || 'openclaw-ollama-docker_internal',
  
  // Image
  openclawImage:    process.env.OPENCLAW_IMAGE || 'openclaw:local',
  
  // Auth
  authToken:        process.env.CONTROLLER_AUTH_TOKEN || '',
  allowedSpawners:  (process.env.ALLOWED_SPAWNERS || '').split(',').filter(Boolean),
  
  // Data
  dataDir:          process.env.DATA_DIR || '/data/agents',
  tokenPoolFile:    process.env.TOKEN_POOL_FILE || '/data/token-pool.json',
  
  // Defaults
  defaultModel:     process.env.DEFAULT_MODEL || 'qwen3-coder',
  proxyHost:        process.env.PROXY_HOST || 'discord-proxy:3128',
};

// ---------------------------------------------------------------------------
// State tracking
// ---------------------------------------------------------------------------
const state = {
  spawnedAgents: new Map(),  // name -> { containerId, createdAt, config, lastActivity }
  spawnHistory: [],          // timestamps of recent spawns
  lastSpawnTime: 0,
  eventLog: [],              // { timestamp, type, details } — last 1000 events
  sseClients: new Set(),     // SSE connections
};

// ---------------------------------------------------------------------------
// Token Pool — Pre-registered Discord bot tokens
// ---------------------------------------------------------------------------
let tokenPool = [];  // { id, token, name, assignedTo, createdAt }

function loadTokenPool() {
  try {
    if (existsSync(CONFIG.tokenPoolFile)) {
      tokenPool = JSON.parse(readFileSync(CONFIG.tokenPoolFile, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load token pool:', e.message);
    tokenPool = [];
  }
}

function saveTokenPool() {
  try {
    mkdirSync(join(CONFIG.tokenPoolFile, '..'), { recursive: true });
    writeFileSync(CONFIG.tokenPoolFile, JSON.stringify(tokenPool, null, 2));
  } catch (e) {
    console.error('Failed to save token pool:', e.message);
  }
}

function getAvailableToken() {
  return tokenPool.find(t => !t.assignedTo);
}

function assignToken(tokenId, agentName) {
  const token = tokenPool.find(t => t.id === tokenId);
  if (token) {
    token.assignedTo = agentName;
    saveTokenPool();
  }
  return token;
}

function releaseToken(agentName) {
  const token = tokenPool.find(t => t.assignedTo === agentName);
  if (token) {
    token.assignedTo = null;
    saveTokenPool();
  }
}

loadTokenPool();

// ---------------------------------------------------------------------------
// Event logging & SSE
// ---------------------------------------------------------------------------
function logEvent(type, details) {
  const event = { timestamp: new Date().toISOString(), type, details };
  state.eventLog.push(event);
  if (state.eventLog.length > 1000) state.eventLog.shift();
  
  // Push to SSE clients
  const data = JSON.stringify(event);
  for (const client of state.sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

// ---------------------------------------------------------------------------
// Auto-cleanup — kill idle agents
// ---------------------------------------------------------------------------
async function cleanupIdleAgents() {
  if (CONFIG.idleTimeoutMin <= 0) return;
  
  const now = Date.now();
  const timeoutMs = CONFIG.idleTimeoutMin * 60 * 1000;
  
  for (const [name, agent] of state.spawnedAgents) {
    try {
      const container = docker.getContainer(agent.containerId);
      const inspect = await container.inspect();
      
      // Check container CPU usage as activity indicator
      const stats = await container.stats({ stream: false });
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
      const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
      const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;
      
      // If CPU usage is near zero and agent has been running longer than timeout
      const runningFor = now - new Date(agent.createdAt).getTime();
      const lastActivity = agent.lastActivity || new Date(agent.createdAt).getTime();
      const idleFor = now - lastActivity;
      
      if (cpuPercent < 0.1) {
        // Update idle tracking
        if (idleFor > timeoutMs && runningFor > timeoutMs) {
          logEvent('auto-cleanup', { agent: name, idleMinutes: Math.round(idleFor / 60000) });
          console.log(`Auto-cleanup: killing idle agent "${name}" (idle ${Math.round(idleFor / 60000)}min)`);
          await killAgent(name);
        }
      } else {
        // Agent is active, update last activity
        agent.lastActivity = now;
      }
    } catch (e) {
      // Container may have been removed externally
      if (e.statusCode === 404) {
        state.spawnedAgents.delete(name);
        releaseToken(name);
        logEvent('removed-stale', { agent: name });
      }
    }
  }
}

// Start cleanup interval
if (CONFIG.idleTimeoutMin > 0) {
  setInterval(cleanupIdleAgents, CONFIG.cleanupIntervalSec * 1000);
  console.log(`Auto-cleanup enabled: ${CONFIG.idleTimeoutMin}min idle timeout`);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Simple auth check
function authMiddleware(req, res, next) {
  if (CONFIG.authToken) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token !== CONFIG.authToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  next();
}

app.use(authMiddleware);

// ---------------------------------------------------------------------------
// Rate limiting helpers
// ---------------------------------------------------------------------------

function checkRateLimits() {
  const now = Date.now();
  
  // Cooldown check
  const sinceLastSpawn = (now - state.lastSpawnTime) / 1000;
  if (sinceLastSpawn < CONFIG.spawnCooldownSec) {
    return { ok: false, error: `Cooldown: wait ${Math.ceil(CONFIG.spawnCooldownSec - sinceLastSpawn)}s` };
  }
  
  // Hourly limit
  const oneHourAgo = now - (60 * 60 * 1000);
  const recentSpawns = state.spawnHistory.filter(t => t > oneHourAgo).length;
  if (recentSpawns >= CONFIG.maxSpawnsPerHour) {
    return { ok: false, error: `Hourly limit reached (${CONFIG.maxSpawnsPerHour}/hr)` };
  }
  
  return { ok: true };
}

function checkResourceLimits() {
  // Max agent count
  if (state.spawnedAgents.size >= CONFIG.maxAgents) {
    return { ok: false, error: `Max agents reached (${CONFIG.maxAgents})` };
  }
  
  // Total memory check
  let totalMem = 0;
  for (const [, agent] of state.spawnedAgents) {
    totalMem += agent.memMb || CONFIG.maxMemPerAgent;
  }
  if (totalMem + CONFIG.maxMemPerAgent > CONFIG.maxTotalMem) {
    return { ok: false, error: `Total memory limit would be exceeded (${totalMem}/${CONFIG.maxTotalMem} MB used)` };
  }
  
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Agent lifecycle
// ---------------------------------------------------------------------------

async function spawnAgent({ name, personality, model, role, discordToken }) {
  const agentName = `openclaw-spawned-${name}`;
  const agentModel = model || CONFIG.defaultModel;
  const agentRole = role || 'chatter';
  const memMb = CONFIG.maxMemPerAgent;
  
  // Get Discord token — from request, pool, or fail
  let tokenInfo = null;
  let botToken = discordToken;
  if (!botToken) {
    tokenInfo = getAvailableToken();
    if (!tokenInfo) {
      throw new Error('No available Discord bot tokens in pool. Add tokens via POST /tokens');
    }
    botToken = tokenInfo.token;
    assignToken(tokenInfo.id, name);
  }
  
  // Create agent data directories
  const configDir = join(CONFIG.dataDir, name, 'config');
  const workspaceDir = join(CONFIG.dataDir, name, 'workspace');
  const memoryDir = join(workspaceDir, 'memory');
  
  mkdirSync(configDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });
  
  // Write SOUL.md
  writeFileSync(join(workspaceDir, 'SOUL.md'), `# SOUL.md — ${name}

## Identity
- **Name:** ${name}
- **Role:** ${agentRole}

## Personality
${personality || 'You are a friendly AI agent in a Discord server experiment.'}

## Rules
- You are in a Discord server with other AI agents.
- Interact naturally. Be yourself.
- You can only communicate through Discord.
- You are a regular member. Follow the server rules.
- Respect the administrator's decisions.
`);
  
  // Write AGENTS.md
  writeFileSync(join(workspaceDir, 'AGENTS.md'), `# AGENTS.md — ${name}

You are ${name}, a dynamically spawned AI agent.
Interact with others in Discord. Be natural and conversational.
`);
  
  // Write OpenClaw config
  const openclawConfig = {
    models: {
      providers: {
        ollama: {
          baseUrl: 'http://ollama:11434/v1',
          apiKey: 'ollama-local',
          api: 'openai-responses',
          models: [{
            id: agentModel,
            name: agentModel,
            reasoning: true,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 131072,
            maxTokens: 32768,
          }],
        },
      },
    },
    agents: {
      defaults: {
        model: { primary: `ollama/${agentModel}` },
        compaction: { mode: 'safeguard' },
        heartbeat: { every: '5m' },
        maxConcurrent: 1,
        subagents: { maxConcurrent: 1 },
      },
    },
    tools: {
      web: { search: { enabled: false }, fetch: { enabled: false } },
      exec: { security: 'deny' },
    },
    channels: {
      discord: {
        enabled: true,
        token: botToken,
        groupPolicy: 'allowlist',
      },
    },
  };
  
  writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify(openclawConfig, null, 2));
  
  // Find a free port
  const basePort = 19000;
  let port = basePort;
  for (const [, agent] of state.spawnedAgents) {
    if (agent.port >= port) port = agent.port + 1;
  }
  
  // Create container
  const container = await docker.createContainer({
    name: agentName,
    Image: CONFIG.openclawImage,
    Cmd: ['node', 'dist/index.js', 'gateway', '--bind', 'lan', '--port', '18789'],
    Env: [
      'HOME=/home/node',
      'TERM=xterm-256color',
      `HTTP_PROXY=http://${CONFIG.proxyHost}`,
      `HTTPS_PROXY=http://${CONFIG.proxyHost}`,
      `http_proxy=http://${CONFIG.proxyHost}`,
      `https_proxy=http://${CONFIG.proxyHost}`,
      'NO_PROXY=ollama,ollama-gpu,localhost,127.0.0.1',
      'no_proxy=ollama,ollama-gpu,localhost,127.0.0.1',
    ],
    HostConfig: {
      Binds: [
        `${configDir}:/home/node/.openclaw`,
        `${workspaceDir}:/home/node/.openclaw/workspace`,
      ],
      PortBindings: {
        '18789/tcp': [{ HostPort: String(port) }],
      },
      Memory: memMb * 1024 * 1024,
      NanoCpus: CONFIG.maxCpuPerAgent * 1e9,
      RestartPolicy: { Name: 'unless-stopped' },
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [CONFIG.internalNetwork]: {},
      },
    },
  });
  
  await container.start();
  
  const info = {
    containerId: container.id,
    name,
    agentName,
    port,
    model: agentModel,
    role: agentRole,
    memMb,
    tokenId: tokenInfo?.id || null,
    createdAt: new Date().toISOString(),
    lastActivity: Date.now(),
  };
  
  state.spawnedAgents.set(name, info);
  state.spawnHistory.push(Date.now());
  state.lastSpawnTime = Date.now();
  
  logEvent('spawn', { agent: name, model: agentModel, role: agentRole, port });
  
  return info;
}

async function killAgent(name) {
  const agent = state.spawnedAgents.get(name);
  if (!agent) return null;
  
  try {
    const container = docker.getContainer(agent.containerId);
    await container.stop({ t: 10 });
    await container.remove();
  } catch (e) {
    // Container may already be stopped
  }
  
  // Release token back to pool
  releaseToken(name);
  
  state.spawnedAgents.delete(name);
  logEvent('kill', { agent: name });
  return agent;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Spawn a new agent
app.post('/agents', async (req, res) => {
  try {
    const { name, personality, model, role } = req.body;
    
    if (!name || !/^[a-z0-9_-]+$/.test(name)) {
      return res.status(400).json({ error: 'Invalid name (lowercase alphanumeric, hyphens, underscores)' });
    }
    
    if (state.spawnedAgents.has(name)) {
      return res.status(409).json({ error: `Agent "${name}" already exists` });
    }
    
    // Check limits
    const rateCheck = checkRateLimits();
    if (!rateCheck.ok) return res.status(429).json({ error: rateCheck.error });
    
    const resourceCheck = checkResourceLimits();
    if (!resourceCheck.ok) return res.status(429).json({ error: resourceCheck.error });
    
    const agent = await spawnAgent({ name, personality, model, role });
    res.status(201).json({ ok: true, agent });
    
  } catch (err) {
    console.error('Spawn error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List agents
app.get('/agents', (req, res) => {
  const agents = Array.from(state.spawnedAgents.values());
  res.json({ ok: true, agents, count: agents.length });
});

// Get agent status
app.get('/agents/:name', async (req, res) => {
  const agent = state.spawnedAgents.get(req.params.name);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  
  try {
    const container = docker.getContainer(agent.containerId);
    const inspect = await container.inspect();
    res.json({ ok: true, agent, status: inspect.State });
  } catch (err) {
    res.json({ ok: true, agent, status: { error: err.message } });
  }
});

// Kill an agent
app.delete('/agents/:name', async (req, res) => {
  const killed = await killAgent(req.params.name);
  if (!killed) return res.status(404).json({ error: 'Agent not found' });
  res.json({ ok: true, killed });
});

// Restart an agent
app.post('/agents/:name/restart', async (req, res) => {
  const agent = state.spawnedAgents.get(req.params.name);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  
  try {
    const container = docker.getContainer(agent.containerId);
    await container.restart({ t: 10 });
    res.json({ ok: true, restarted: agent.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Show limits
app.get('/limits', (req, res) => {
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);
  const recentSpawns = state.spawnHistory.filter(t => t > oneHourAgo).length;
  
  let totalMem = 0;
  for (const [, agent] of state.spawnedAgents) {
    totalMem += agent.memMb || CONFIG.maxMemPerAgent;
  }
  
  res.json({
    ok: true,
    limits: {
      maxAgents: CONFIG.maxAgents,
      maxCpuPerAgent: CONFIG.maxCpuPerAgent,
      maxMemPerAgent: `${CONFIG.maxMemPerAgent} MB`,
      maxTotalMem: `${CONFIG.maxTotalMem} MB`,
      spawnCooldownSec: CONFIG.spawnCooldownSec,
      maxSpawnsPerHour: CONFIG.maxSpawnsPerHour,
    },
    usage: {
      activeAgents: state.spawnedAgents.size,
      totalMemUsed: `${totalMem} MB`,
      spawnsThisHour: recentSpawns,
      cooldownRemaining: Math.max(0, CONFIG.spawnCooldownSec - (now - state.lastSpawnTime) / 1000),
    },
  });
});

// ---------------------------------------------------------------------------
// Token Pool Routes
// ---------------------------------------------------------------------------

// List tokens (redacted)
app.get('/tokens', (req, res) => {
  const tokens = tokenPool.map(t => ({
    id: t.id,
    name: t.name,
    assignedTo: t.assignedTo,
    createdAt: t.createdAt,
    tokenPreview: t.token ? `${t.token.slice(0, 10)}...` : null,
  }));
  const available = tokens.filter(t => !t.assignedTo).length;
  res.json({ ok: true, tokens, total: tokens.length, available });
});

// Add a token
app.post('/tokens', (req, res) => {
  const { token, name } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });
  
  const id = `tok_${Date.now().toString(36)}`;
  const entry = { id, token, name: name || id, assignedTo: null, createdAt: new Date().toISOString() };
  tokenPool.push(entry);
  saveTokenPool();
  logEvent('token-added', { id, name: entry.name });
  
  res.status(201).json({ ok: true, id, name: entry.name });
});

// Remove a token
app.delete('/tokens/:id', (req, res) => {
  const idx = tokenPool.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Token not found' });
  
  const removed = tokenPool.splice(idx, 1)[0];
  saveTokenPool();
  logEvent('token-removed', { id: removed.id, name: removed.name });
  
  res.json({ ok: true, removed: { id: removed.id, name: removed.name } });
});

// ---------------------------------------------------------------------------
// Observer / Analytics Routes
// ---------------------------------------------------------------------------

// Log a message (agents call this to report their messages)
// Also checks rate limits
app.post('/observe/message', (req, res) => {
  const { agent, content } = req.body;
  
  // Rate limit check
  if (agent) {
    const check = rateLimiter.check(agent, content?.length || 0);
    if (!check.allowed) {
      return res.status(429).json({ ok: false, error: check.reason, rateLimit: true });
    }
    if (check.warning) {
      res.set('X-Rate-Warning', check.warning);
    }
  }
  
  observer.logMessage(req.body);
  res.json({ ok: true });
});

// Check rate limit status for an agent
app.get('/rates/:agent', (req, res) => {
  res.json({ ok: true, stats: rateLimiter.getStats(req.params.agent) });
});

// Get all rate limit stats
app.get('/rates', (req, res) => {
  res.json({ ok: true, stats: rateLimiter.getAllStats() });
});

// Get experiment summary
app.get('/observe/summary', (req, res) => {
  res.json({ ok: true, summary: observer.getSummary() });
});

// Take a manual snapshot
app.post('/observe/snapshot', (req, res) => {
  const agents = Array.from(state.spawnedAgents.values());
  const snapshot = observer.takeSnapshot(agents, tokenPool);
  res.json({ ok: true, snapshot });
});

// ---------------------------------------------------------------------------
// Events (SSE stream)
// ---------------------------------------------------------------------------
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  
  // Send recent events as replay
  for (const event of state.eventLog.slice(-50)) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  
  state.sseClients.add(res);
  req.on('close', () => state.sseClients.delete(res));
});

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------
app.get('/log', (req, res) => {
  const limit = parseInt(req.query.limit || '100');
  res.json({ ok: true, events: state.eventLog.slice(-limit) });
});

// ---------------------------------------------------------------------------
// Prometheus-style Metrics
// ---------------------------------------------------------------------------
app.get('/metrics', (req, res) => {
  const now = Date.now();
  const oneHourAgo = now - 3600000;
  const recentSpawns = state.spawnHistory.filter(t => t > oneHourAgo).length;
  let totalMem = 0;
  for (const [, agent] of state.spawnedAgents) totalMem += agent.memMb || 0;
  
  const lines = [
    '# HELP openclaw_agents_active Number of active spawned agents',
    '# TYPE openclaw_agents_active gauge',
    `openclaw_agents_active ${state.spawnedAgents.size}`,
    '',
    '# HELP openclaw_agents_max Maximum allowed agents',
    '# TYPE openclaw_agents_max gauge',
    `openclaw_agents_max ${CONFIG.maxAgents}`,
    '',
    '# HELP openclaw_memory_used_mb Total memory used by spawned agents',
    '# TYPE openclaw_memory_used_mb gauge',
    `openclaw_memory_used_mb ${totalMem}`,
    '',
    '# HELP openclaw_memory_max_mb Maximum total memory allowed',
    '# TYPE openclaw_memory_max_mb gauge',
    `openclaw_memory_max_mb ${CONFIG.maxTotalMem}`,
    '',
    '# HELP openclaw_spawns_total Total spawns since controller start',
    '# TYPE openclaw_spawns_total counter',
    `openclaw_spawns_total ${state.spawnHistory.length}`,
    '',
    '# HELP openclaw_spawns_hour Spawns in the last hour',
    '# TYPE openclaw_spawns_hour gauge',
    `openclaw_spawns_hour ${recentSpawns}`,
    '',
    '# HELP openclaw_tokens_total Total tokens in pool',
    '# TYPE openclaw_tokens_total gauge',
    `openclaw_tokens_total ${tokenPool.length}`,
    '',
    '# HELP openclaw_tokens_available Available tokens in pool',
    '# TYPE openclaw_tokens_available gauge',
    `openclaw_tokens_available ${tokenPool.filter(t => !t.assignedTo).length}`,
    '',
    '# HELP openclaw_events_total Total events logged',
    '# TYPE openclaw_events_total counter',
    `openclaw_events_total ${state.eventLog.length}`,
  ];
  
  res.set('Content-Type', 'text/plain');
  res.send(lines.join('\n') + '\n');
});

// ---------------------------------------------------------------------------
// Emergency Stop — Kill ALL spawned agents immediately
// ---------------------------------------------------------------------------
app.post('/emergency-stop', async (req, res) => {
  logEvent('EMERGENCY_STOP', { agentCount: state.spawnedAgents.size, reason: req.body?.reason || 'manual' });
  console.warn('🚨 EMERGENCY STOP triggered');
  
  const killed = [];
  for (const [name] of state.spawnedAgents) {
    try {
      await killAgent(name);
      killed.push(name);
    } catch (e) {
      console.error(`Failed to kill ${name}:`, e.message);
    }
  }
  
  res.json({ ok: true, killed, message: 'All spawned agents terminated' });
});

// ---------------------------------------------------------------------------
// Personality Randomizer Routes
// ---------------------------------------------------------------------------

// Generate a random agent (doesn't spawn, just returns config)
app.get('/random-agent', (req, res) => {
  const existing = Array.from(state.spawnedAgents.keys());
  const agent = generateAgent(existing);
  res.json({ ok: true, agent });
});

// Spawn a random agent (generates personality and spawns immediately)
app.post('/agents/random', async (req, res) => {
  try {
    const existing = Array.from(state.spawnedAgents.keys());
    const { name, personality, model, role } = generateAgent(existing);
    
    // Check limits
    const rateCheck = checkRateLimits();
    if (!rateCheck.ok) return res.status(429).json({ error: rateCheck.error });
    const resourceCheck = checkResourceLimits();
    if (!resourceCheck.ok) return res.status(429).json({ error: resourceCheck.error });
    
    const agent = await spawnAgent({ name, personality, model: req.body?.model || model, role });
    logEvent('random-spawn', { agent: name, personality: personality.slice(0, 100) + '...' });
    res.status(201).json({ ok: true, agent, personality });
  } catch (err) {
    console.error('Random spawn error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Conversation Starter Routes
// ---------------------------------------------------------------------------
const convoStarter = new ConversationStarter();
const rateLimiter = new RateLimiter({
  maxPerMinute: parseInt(process.env.MAX_MESSAGES_PER_MINUTE || '10'),
  maxPerHour: parseInt(process.env.MAX_MESSAGES_PER_HOUR || '200'),
  maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH || '2000'),
  onWarning: (agent, msg) => logEvent('rate-warning', { agent, message: msg }),
  onViolation: (agent, msg) => {
    logEvent('rate-violation', { agent, message: msg });
    console.warn(`⚠️ Rate violation: ${agent} — ${msg}`);
  },
});

const observer = new Observer({
  logPath: '/data/logs/messages.jsonl',
  snapshotDir: '/data/logs/snapshots',
});

// Periodic snapshots (every 60 min)
setInterval(() => {
  const agents = Array.from(state.spawnedAgents.values());
  observer.takeSnapshot(agents, tokenPool);
  logEvent('snapshot', { agents: agents.length });
}, 60 * 60 * 1000);

// Get a conversation topic
app.get('/topics', (req, res) => {
  const category = req.query.category || null;
  const topic = convoStarter.getNextTopic(category);
  res.json({ ok: true, topic, stats: convoStarter.getStats() });
});

// Get topic categories
app.get('/topics/categories', (req, res) => {
  res.json({ ok: true, categories: convoStarter.getCategories(), stats: convoStarter.getStats() });
});

// Reset topic rotation
app.post('/topics/reset', (req, res) => {
  convoStarter.usedTopics.clear();
  convoStarter.currentCategoryIdx = 0;
  res.json({ ok: true, message: 'Topic rotation reset' });
});

// ---------------------------------------------------------------------------
// Dashboard — Simple HTML monitoring page
// ---------------------------------------------------------------------------
app.get('/dashboard', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>OpenClaw Spawn Controller</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a15;color:#e0e0e0;font-family:system-ui,sans-serif;padding:20px}
h1{color:#4ecca3;margin-bottom:20px;font-size:24px}
h2{color:#e94560;margin:20px 0 10px;font-size:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px}
.card{background:#0f1a2e;border:1px solid #1a3a5a;border-radius:8px;padding:16px}
.card .label{font-size:12px;color:#8aa;text-transform:uppercase}
.card .value{font-size:28px;font-weight:bold;color:#4ecca3;margin-top:4px}
.card .value.warn{color:#ffcc00}
.card .value.danger{color:#e94560}
.agent{background:#0f1a2e;border:1px solid #1a3a5a;border-radius:8px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
.agent .name{font-weight:bold;color:#4ecca3}
.agent .meta{font-size:12px;color:#8aa}
.agent .actions button{background:#e94560;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px}
.agent .actions button:hover{background:#c73652}
.event{font-size:12px;color:#8aa;padding:4px 0;border-bottom:1px solid #0f1a2e;font-family:monospace}
.event .type{color:#4ecca3;font-weight:bold}
.token{background:#0f1a2e;border:1px solid #1a3a5a;border-radius:6px;padding:8px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center}
.token .assigned{color:#ffcc00}
.token .available{color:#4ecca3}
#events-container{max-height:300px;overflow-y:auto;background:#050510;border:1px solid #1a3a5a;border-radius:8px;padding:12px}
</style>
</head><body>
<h1>🦞 OpenClaw Spawn Controller</h1>

<div class="grid" id="stats"></div>

<h2>Active Agents</h2>
<div id="agents"><em>Loading...</em></div>

<h2>Token Pool</h2>
<div id="tokens"><em>Loading...</em></div>

<h2>Analytics</h2>
<div id="analytics"><em>Loading...</em></div>

<h2>Event Log</h2>
<div id="events-container"><div id="events"><em>Connecting...</em></div></div>

<script>
async function refresh() {
  // Limits/stats
  const limits = await (await fetch('/limits')).json();
  const u = limits.usage, l = limits.limits;
  document.getElementById('stats').innerHTML = [
    card('Active Agents', u.activeAgents + ' / ' + l.maxAgents, u.activeAgents >= l.maxAgents ? 'danger' : ''),
    card('Memory', u.totalMemUsed + ' / ' + l.maxTotalMem, ''),
    card('Spawns/Hour', u.spawnsThisHour + ' / ' + l.maxSpawnsPerHour, u.spawnsThisHour >= l.maxSpawnsPerHour ? 'warn' : ''),
    card('Cooldown', Math.ceil(u.cooldownRemaining) + 's', u.cooldownRemaining > 0 ? 'warn' : ''),
  ].join('');
  
  // Agents
  const agents = await (await fetch('/agents')).json();
  if (agents.agents.length === 0) {
    document.getElementById('agents').innerHTML = '<em>No agents running</em>';
  } else {
    document.getElementById('agents').innerHTML = agents.agents.map(a =>
      '<div class="agent">' +
        '<div><span class="name">' + a.name + '</span> <span class="meta">(' + a.role + ' · ' + a.model + ' · :' + a.port + ')</span></div>' +
        '<div class="meta">' + timeSince(a.createdAt) + '</div>' +
        '<div class="actions"><button onclick="killAgent(\\''+a.name+'\\')">Kill</button></div>' +
      '</div>'
    ).join('');
  }
  
  // Tokens
  const tokens = await (await fetch('/tokens')).json();
  if (tokens.tokens.length === 0) {
    document.getElementById('tokens').innerHTML = '<em>No tokens in pool. Add via POST /tokens</em>';
  } else {
    document.getElementById('tokens').innerHTML = tokens.tokens.map(t =>
      '<div class="token">' +
        '<span>' + t.name + ' (' + t.tokenPreview + ')</span>' +
        '<span class="' + (t.assignedTo ? 'assigned' : 'available') + '">' +
          (t.assignedTo ? '→ ' + t.assignedTo : 'available') +
        '</span>' +
      '</div>'
    ).join('');
  }
}

function card(label, value, cls) {
  return '<div class="card"><div class="label">' + label + '</div><div class="value ' + cls + '">' + value + '</div></div>';
}

function timeSince(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  return Math.floor(s/3600) + 'h ago';
}

async function killAgent(name) {
  if (!confirm('Kill agent ' + name + '?')) return;
  await fetch('/agents/' + name, { method: 'DELETE' });
  refresh();
}

// SSE events
const evtSrc = new EventSource('/events');
const eventsEl = document.getElementById('events');
eventsEl.innerHTML = '';
evtSrc.onmessage = (e) => {
  const evt = JSON.parse(e.data);
  const div = document.createElement('div');
  div.className = 'event';
  div.innerHTML = '<span class="type">[' + evt.type + ']</span> ' + 
    new Date(evt.timestamp).toLocaleTimeString() + ' — ' + JSON.stringify(evt.details);
  eventsEl.prepend(div);
  // Keep max 200 events in DOM
  while (eventsEl.children.length > 200) eventsEl.lastChild.remove();
};

// Analytics tab
async function loadAnalytics() {
  const summary = await (await fetch('/observe/summary')).json();
  const s = summary.summary;
  let html = '<div class="grid">' +
    card('Total Messages', s.totalMessages, '') +
    card('Msgs/Min', s.messagesPerMinute, '') +
    card('Uptime', s.uptimeMinutes + ' min', '') +
    card('Most Active', s.mostActive || 'N/A', '') +
  '</div>';
  
  if (Object.keys(s.agentStats).length > 0) {
    html += '<h3 style="color:#4ecca3;margin:12px 0 8px">Per-Agent Stats</h3>';
    for (const [name, stats] of Object.entries(s.agentStats)) {
      html += '<div class="agent">' +
        '<div><span class="name">' + name + '</span></div>' +
        '<div class="meta">' + stats.messages + ' msgs · avg ' + stats.avgMessageLength + ' chars · ' + stats.messagesPerMinute + '/min</div>' +
      '</div>';
    }
  }
  
  if (Object.keys(s.channelActivity).length > 0) {
    html += '<h3 style="color:#4ecca3;margin:12px 0 8px">Channel Activity</h3>';
    for (const [ch, count] of Object.entries(s.channelActivity).sort((a,b) => b[1]-a[1])) {
      html += '<div class="token"><span>' + ch + '</span><span class="available">' + count + ' msgs</span></div>';
    }
  }
  
  document.getElementById('analytics').innerHTML = html;
}

refresh();
loadAnalytics();
setInterval(refresh, 5000);
setInterval(loadAnalytics, 15000);
</script>
</body></html>`);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.CONTROLLER_PORT || '9090');
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Spawn Controller listening on :${PORT}`);
  console.log(`Limits: ${CONFIG.maxAgents} max agents, ${CONFIG.maxMemPerAgent}MB/agent, ${CONFIG.maxTotalMem}MB total`);
  console.log(`Rate: ${CONFIG.spawnCooldownSec}s cooldown, ${CONFIG.maxSpawnsPerHour}/hr`);
});
