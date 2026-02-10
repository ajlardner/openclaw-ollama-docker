/**
 * WWE Discord Director
 * 
 * The "booker" — manages the WWE Discord experiment.
 * 
 * Architecture:
 * - ONE Discord bot reads all messages
 * - Storyline engine decides which characters respond
 * - Ollama generates responses in-character
 * - Discord webhooks post responses with character names/avatars
 */

import { Client, GatewayIntentBits, WebhookClient } from 'discord.js';
import express from 'express';
import { CHARACTERS, getCharacter, listCharacters, getAllFeuds } from './characters.js';
import { StorylineEngine } from './storyline-engine.js';
import { ChampionshipTracker, CHAMPIONSHIPS } from './championships.js';
import { ANNOUNCERS, getAnnouncerReactions, buildAnnouncerPrompt } from './announcers.js';
import { MatchEngine, MATCH_TYPES } from './match-engine.js';
import { getCharacterChant, getMatchReaction, getDuelingChant, shouldCrowdReact } from './crowd.js';
import { PPVEngine, PPV_TEMPLATES } from './ppv-engine.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CONFIG = {
  discordToken: process.env.DISCORD_BOT_TOKEN,
  ollamaUrl: process.env.OLLAMA_URL || 'http://ollama:11434',
  model: process.env.OLLAMA_MODEL || 'qwen3-coder',
  guildId: process.env.DISCORD_GUILD_ID,
  channelId: process.env.DISCORD_CHANNEL_ID,
  webhookUrl: process.env.DISCORD_WEBHOOK_URL,
  apiPort: parseInt(process.env.DIRECTOR_PORT || '9091'),
  responseDelayMs: parseInt(process.env.RESPONSE_DELAY_MS || '3000'),
  typingDelayPerChar: parseInt(process.env.TYPING_DELAY_PER_CHAR || '30'),
  maxResponseLength: parseInt(process.env.MAX_RESPONSE_LENGTH || '500'),
  promoIntervalMinutes: parseInt(process.env.PROMO_INTERVAL_MIN || '30'),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const storyline = new StorylineEngine();
const championships = new ChampionshipTracker();
const matchEngine = new MatchEngine();
const ppvEngine = new PPVEngine();
let webhookClient = null;
let discordClient = null;
const messageHistory = [];
const MAX_HISTORY = 50;
let isPaused = false;

// ---------------------------------------------------------------------------
// Discord Bot Setup
// ---------------------------------------------------------------------------
async function startDiscord() {
  if (!CONFIG.discordToken) {
    console.warn('DISCORD_BOT_TOKEN not set — running in API-only mode');
    return;
  }
  
  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  
  if (CONFIG.webhookUrl) {
    webhookClient = new WebhookClient({ url: CONFIG.webhookUrl });
  }
  
  discordClient.on('ready', () => {
    console.log(`Discord bot logged in as ${discordClient.user.tag}`);
    console.log(`Watching guild: ${CONFIG.guildId}, channel: ${CONFIG.channelId}`);
  });
  
  discordClient.on('messageCreate', async (message) => {
    if (message.webhookId) return;
    if (message.author.bot && message.author.id === discordClient.user.id) return;
    if (CONFIG.channelId && message.channel.id !== CONFIG.channelId) return;
    if (isPaused) return;
    
    messageHistory.push({
      author: message.author.username,
      content: message.content,
      timestamp: Date.now(),
    });
    while (messageHistory.length > MAX_HISTORY) messageHistory.shift();
    
    const authorCharacterId = identifyCharacter(message.author.username);
    const responders = storyline.decideResponders(message.content, authorCharacterId);
    
    if (responders.length === 0) return;
    
    for (const responder of responders) {
      const delay = CONFIG.responseDelayMs + Math.random() * 2000;
      await sleep(delay);
      
      try { await message.channel.sendTyping(); } catch (e) {}
      
      const response = await generateResponse(responder, message.content, messageHistory);
      if (!response) continue;
      
      const typingDelay = Math.min(response.length * CONFIG.typingDelayPerChar, 5000);
      await sleep(typingDelay);
      
      await sendAsCharacter(responder.characterId, response, message.channel);
      
      // Trigger announcer commentary + crowd reaction for dramatic moments
      if (responder.isSurprise) {
        const char = getCharacter(responder.characterId);
        triggerAnnouncerCommentary(responder.reason, `${char?.name || responder.characterId} just appeared!`, message.channel);
        if (shouldCrowdReact('entrance')) {
          const chant = getCharacterChant(responder.characterId) || getMatchReaction('entrance');
          if (chant) {
            await sleep(1500);
            if (webhookClient) {
              await webhookClient.send({ content: chant, username: '👥 The Crowd' });
            } else {
              await message.channel.send(chant);
            }
          }
        }
      }
    }
  });
  
  await discordClient.login(CONFIG.discordToken);
}

// ---------------------------------------------------------------------------
// Character Identification
// ---------------------------------------------------------------------------
function identifyCharacter(username) {
  for (const [id, char] of Object.entries(CHARACTERS)) {
    if (username.toLowerCase().includes(char.name.toLowerCase().split(' ')[0])) {
      return id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ollama Response Generation
// ---------------------------------------------------------------------------
async function generateResponse(responder, triggerMessage, history) {
  const char = getCharacter(responder.characterId);
  if (!char) return null;
  
  const recentMessages = history.slice(-10).map(m => 
    `${m.author}: ${m.content}`
  ).join('\n');
  
  const systemPrompt = char.personality;
  
  let userPrompt = `Here's the recent conversation in the Discord server:\n\n${recentMessages}\n\n`;
  if (responder.context) userPrompt += `STORYLINE DIRECTION: ${responder.context}\n\n`;
  if (responder.isSurprise) userPrompt += `THIS IS YOUR DRAMATIC ENTRANCE. Make it memorable.\n\n`;
  
  // Add championship context
  const charTitles = championships.getTitlesForCharacter(responder.characterId);
  if (charTitles.length > 0) {
    userPrompt += `YOU ARE THE CURRENT ${charTitles.map(t => t.displayName).join(' AND ')} CHAMPION. Reference your gold.\n\n`;
  }
  userPrompt += `Respond in character as ${char.name}. Keep it to 1-3 sentences max (this is Discord chat, not a speech). Be entertaining and stay in character.`;
  
  try {
    const response = await fetch(`${CONFIG.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CONFIG.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        options: { temperature: 0.9, top_p: 0.95, num_predict: 200 },
      }),
    });
    
    const data = await response.json();
    let text = data.message?.content || '';
    
    if (text.length > CONFIG.maxResponseLength) {
      text = text.slice(0, CONFIG.maxResponseLength).trim();
      const lastEnd = Math.max(text.lastIndexOf('.'), text.lastIndexOf('!'), text.lastIndexOf('?'));
      if (lastEnd > text.length * 0.5) text = text.slice(0, lastEnd + 1);
    }
    
    return text.trim();
  } catch (err) {
    console.error(`Ollama error for ${char.name}:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Send Message as Character
// ---------------------------------------------------------------------------
async function sendAsCharacter(characterId, content, channel) {
  const char = getCharacter(characterId);
  if (!char || !content) return;
  
  try {
    if (webhookClient) {
      await webhookClient.send({
        content,
        username: char.displayName,
        avatarURL: char.avatar,
      });
    } else if (channel) {
      await channel.send(`**${char.displayName}:** ${content}`);
    }
    
    messageHistory.push({
      author: char.name,
      content,
      timestamp: Date.now(),
      isCharacter: true,
    });
    while (messageHistory.length > MAX_HISTORY) messageHistory.shift();
    
    console.log(`[${char.name}] ${content.slice(0, 100)}...`);
  } catch (err) {
    console.error(`Failed to send as ${char.name}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Scheduled Promos
// ---------------------------------------------------------------------------
function startPromoSchedule() {
  if (CONFIG.promoIntervalMinutes <= 0) return;
  
  setInterval(async () => {
    if (isPaused) return;
    
    const activeChars = storyline.getState().activeCharacters;
    if (activeChars.length === 0) return;
    
    const charId = activeChars[Math.floor(Math.random() * activeChars.length)];
    const promoPrompt = storyline.generatePromo(charId);
    if (!promoPrompt) return;
    
    const response = await generateResponse(
      { characterId: charId, context: promoPrompt, reason: 'scheduled-promo' },
      '(The arena goes quiet as the lights dim...)',
      messageHistory
    );
    
    if (response && CONFIG.channelId && discordClient) {
      const channel = discordClient.channels?.cache?.get(CONFIG.channelId);
      if (channel) await sendAsCharacter(charId, response, channel);
    }
  }, CONFIG.promoIntervalMinutes * 60 * 1000);
  
  console.log(`Promo schedule: every ${CONFIG.promoIntervalMinutes} minutes`);
}

// ---------------------------------------------------------------------------
// API Server + Live Control Dashboard
// ---------------------------------------------------------------------------
function startAPI() {
  const app = express();
  app.use(express.json());
  
  // ---------- API Routes ----------
  
  app.get('/state', (req, res) => {
    res.json({ ok: true, state: storyline.getState(), messages: messageHistory.length, paused: isPaused });
  });
  
  app.post('/pause', (req, res) => {
    isPaused = true;
    res.json({ ok: true, paused: true });
  });
  
  app.post('/resume', (req, res) => {
    isPaused = false;
    res.json({ ok: true, paused: false });
  });
  
  app.post('/speak', async (req, res) => {
    const { characterId, prompt } = req.body;
    if (!characterId) return res.status(400).json({ error: 'characterId required' });
    
    const response = await generateResponse(
      { characterId, context: prompt || 'Say something in character.', reason: 'forced' },
      messageHistory.slice(-1)[0]?.content || '',
      messageHistory
    );
    
    if (response && CONFIG.channelId && discordClient) {
      const channel = discordClient.channels?.cache?.get(CONFIG.channelId);
      if (channel) await sendAsCharacter(characterId, response, channel);
    }
    
    res.json({ ok: true, character: characterId, response });
  });
  
  app.post('/surprise', async (req, res) => {
    const { characterId } = req.body;
    if (characterId && !storyline.getState().activeCharacters.includes(characterId)) {
      storyline.addCharacterToWings(characterId);
    }
    
    const surprise = storyline.triggerSurprise();
    if (!surprise) return res.json({ ok: false, message: 'No characters waiting in wings' });
    
    const response = await generateResponse(
      surprise,
      messageHistory.slice(-1)[0]?.content || 'The arena goes quiet...',
      messageHistory
    );
    
    if (response && CONFIG.channelId && discordClient) {
      const channel = discordClient.channels?.cache?.get(CONFIG.channelId);
      if (channel) await sendAsCharacter(surprise.characterId, response, channel);
    }
    
    res.json({ ok: true, character: surprise.characterId, type: surprise.reason, response });
  });
  
  app.post('/feud', (req, res) => {
    const { char1, char2, intensity } = req.body;
    if (!char1 || !char2) return res.status(400).json({ error: 'char1 and char2 required' });
    const feud = storyline.createFeud(char1, char2, intensity || 5);
    res.json({ ok: true, feud });
  });
  
  app.get('/characters', (req, res) => {
    const chars = {};
    const state = storyline.getState();
    for (const [id, char] of Object.entries(CHARACTERS)) {
      chars[id] = {
        name: char.name,
        displayName: char.displayName,
        alignment: char.alignment,
        era: char.era,
        finisher: char.finisher,
        active: state.activeCharacters.includes(id),
        inWings: state.waitingInTheWings.includes(id),
        heat: state.heatMap[id] || 0,
      };
    }
    res.json({ ok: true, characters: chars });
  });
  
  app.post('/characters', (req, res) => {
    const { id, active } = req.body;
    if (!id || !getCharacter(id)) return res.status(400).json({ error: 'Unknown character' });
    
    if (active) {
      if (!storyline.getState().activeCharacters.includes(id)) {
        storyline.activeCharacters.push(id);
        storyline.waitingInTheWings = storyline.waitingInTheWings.filter(c => c !== id);
      }
    } else {
      storyline.addCharacterToWings(id);
    }
    
    storyline.saveState().catch(() => {});
    res.json({ ok: true, state: storyline.getState() });
  });
  
  // ---------- Championship Routes ----------
  
  app.get('/championships', (req, res) => {
    res.json({ ok: true, championships: championships.getState() });
  });
  
  app.post('/championships/award', async (req, res) => {
    const { titleId, characterId, method } = req.body;
    if (!titleId || !characterId) return res.status(400).json({ error: 'titleId and characterId required' });
    
    const result = championships.awardTitle(titleId, characterId, method || 'pinfall');
    if (!result) return res.status(400).json({ error: 'Invalid title' });
    
    // Save championship state with storyline
    storyline.championshipData = championships.toJSON();
    await storyline.saveState();
    
    // Trigger announcer commentary for title changes
    if (CONFIG.channelId && discordClient) {
      const channel = discordClient.channels?.cache?.get(CONFIG.channelId);
      const char = getCharacter(characterId);
      const announcement = `🏆 **NEW ${result.titleName.toUpperCase()} CHAMPION: ${char?.displayName || characterId}!**`;
      
      if (webhookClient) {
        await webhookClient.send({ content: announcement, username: '📢 Ring Announcer' });
      } else if (channel) {
        await channel.send(announcement);
      }
      
      if (channel) {
        triggerAnnouncerCommentary('title-change', `${char?.name} just won the ${result.titleName}! Previous champion: ${result.previousChampion || 'vacant'}`, channel);
      }
    }
    
    res.json({ ok: true, result });
  });
  
  app.post('/championships/vacate', async (req, res) => {
    const { titleId } = req.body;
    if (!titleId) return res.status(400).json({ error: 'titleId required' });
    championships.vacateTitle(titleId);
    storyline.championshipData = championships.toJSON();
    await storyline.saveState();
    res.json({ ok: true });
  });
  
  // ---------- Match Routes ----------

  app.get('/matches', (req, res) => {
    res.json({ ok: true, ...matchEngine.getState() });
  });

  app.post('/matches/simulate', async (req, res) => {
    const { participants, matchType, forTitle } = req.body;
    if (!participants || participants.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 participants' });
    }

    const result = matchEngine.simulateFullMatch(participants, matchType || 'singles', { forTitle });
    if (result.error) return res.status(400).json(result);

    // If for a title, award it to the winner
    if (forTitle && result.match.winner) {
      const titleResult = championships.awardTitle(forTitle, result.match.winner, result.match.winMethod);
      result.titleChange = titleResult;
      storyline.championshipData = championships.toJSON();
    }

    // Save match data with storyline
    storyline.matchData = matchEngine.toJSON();
    await storyline.saveState();

    // Post match results to Discord
    if (CONFIG.channelId && discordClient) {
      const channel = discordClient.channels?.cache?.get(CONFIG.channelId);
      if (channel) {
        await postMatchToDiscord(result, channel);
      }
    }

    res.json({ ok: true, result });
  });

  // ---------- PPV Routes ----------

  app.get('/ppv', (req, res) => {
    res.json({ ok: true, ...ppvEngine.getState() });
  });

  app.post('/ppv/schedule', async (req, res) => {
    const { templateId, name, scheduledAt } = req.body;
    if (!templateId) return res.status(400).json({ error: 'templateId required' });
    const event = ppvEngine.scheduleEvent(templateId, { name, scheduledAt });
    if (event.error) return res.status(400).json(event);
    storyline.ppvData = ppvEngine.toJSON();
    await storyline.saveState();
    res.json({ ok: true, event });
  });

  app.post('/ppv/:eventId/add-match', async (req, res) => {
    const { participants, matchType, forTitle, isMainEvent } = req.body;
    if (!participants || participants.length < 2) return res.status(400).json({ error: 'Need participants' });
    const result = ppvEngine.addMatch(req.params.eventId, { participants, matchType, forTitle, isMainEvent });
    if (result.error) return res.status(400).json(result);
    storyline.ppvData = ppvEngine.toJSON();
    await storyline.saveState();
    res.json({ ok: true, match: result });
  });

  app.post('/ppv/:eventId/auto-book', async (req, res) => {
    const event = ppvEngine.scheduledEvents.find(e => e.id === req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const card = ppvEngine.autoBookCard(event, storyline.feuds, storyline.activeCharacters, championships);
    event.matchCard = card;
    storyline.ppvData = ppvEngine.toJSON();
    await storyline.saveState();
    res.json({ ok: true, card });
  });

  app.post('/ppv/:eventId/run', async (req, res) => {
    const event = ppvEngine.startEvent(req.params.eventId);
    if (event.error) return res.status(400).json(event);

    res.json({ ok: true, message: 'PPV started! Matches will play out in Discord.', event });

    // Run the PPV in the background
    runPPV(event).catch(err => console.error('PPV error:', err));
  });

  app.get('/history', (req, res) => {
    const limit = parseInt(req.query.limit || '50');
    res.json({ ok: true, messages: messageHistory.slice(-limit) });
  });
  
  // ---------- Live Control Dashboard ----------
  
  app.get('/dashboard', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(DASHBOARD_HTML);
  });
  
  app.listen(CONFIG.apiPort, '0.0.0.0', () => {
    console.log(`Director API + Dashboard on :${CONFIG.apiPort}`);
    console.log(`Dashboard: http://localhost:${CONFIG.apiPort}/dashboard`);
  });
}

// ---------------------------------------------------------------------------
// Dashboard HTML
// ---------------------------------------------------------------------------
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>🎤 WWE Director — Live Control</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; }
  
  .header { background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 20px; text-align: center; border-bottom: 3px solid #e94560; }
  .header h1 { font-size: 2em; color: #e94560; text-shadow: 0 0 20px rgba(233,69,96,0.5); }
  .header .status { margin-top: 8px; font-size: 0.9em; color: #aaa; }
  .header .status .live { color: #4ade80; font-weight: bold; }
  .header .status .paused { color: #fbbf24; font-weight: bold; }
  
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px; max-width: 1400px; margin: 0 auto; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  
  .card { background: #1a1a2e; border-radius: 12px; padding: 16px; border: 1px solid #333; }
  .card h2 { color: #e94560; margin-bottom: 12px; font-size: 1.1em; }
  
  .character-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
  .char-card { background: #16213e; border-radius: 8px; padding: 12px; text-align: center; cursor: pointer; transition: all 0.2s; border: 2px solid transparent; }
  .char-card:hover { border-color: #e94560; transform: translateY(-2px); }
  .char-card.active { border-color: #4ade80; }
  .char-card.wings { border-color: #fbbf24; opacity: 0.7; }
  .char-card.inactive { opacity: 0.4; }
  .char-card .name { font-weight: bold; font-size: 1.1em; margin-bottom: 4px; }
  .char-card .alignment { font-size: 0.8em; color: #aaa; }
  .char-card .heat { font-size: 0.75em; color: #e94560; margin-top: 4px; }
  .char-card .status-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.7em; margin-top: 4px; }
  .char-card .status-badge.active { background: #065f46; color: #4ade80; }
  .char-card .status-badge.wings { background: #78350f; color: #fbbf24; }
  
  .feud-list { list-style: none; }
  .feud-list li { padding: 8px 12px; margin-bottom: 6px; background: #16213e; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; }
  .feud-list .vs { color: #e94560; font-weight: bold; margin: 0 8px; }
  .feud-list .intensity { font-size: 0.85em; }
  .intensity-bar { width: 100px; height: 8px; background: #333; border-radius: 4px; overflow: hidden; display: inline-block; vertical-align: middle; margin-left: 8px; }
  .intensity-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
  
  .controls { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
  .btn { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 0.9em; font-weight: 600; transition: all 0.2s; }
  .btn:hover { transform: translateY(-1px); }
  .btn-red { background: #e94560; color: white; }
  .btn-green { background: #4ade80; color: #0a0a0a; }
  .btn-yellow { background: #fbbf24; color: #0a0a0a; }
  .btn-blue { background: #60a5fa; color: #0a0a0a; }
  
  .chat-log { max-height: 400px; overflow-y: auto; font-family: monospace; font-size: 0.85em; background: #0f0f1a; border-radius: 8px; padding: 12px; }
  .chat-log .msg { margin-bottom: 6px; padding: 4px 0; border-bottom: 1px solid #1a1a2e; }
  .chat-log .msg .author { font-weight: bold; }
  .chat-log .msg .time { color: #666; font-size: 0.8em; }
  .chat-log .msg.character { color: #fbbf24; }
  
  .input-row { display: flex; gap: 8px; margin-top: 8px; }
  .input-row select, .input-row input { padding: 8px; border-radius: 6px; border: 1px solid #333; background: #16213e; color: #e0e0e0; flex: 1; }
  
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
  .stat { text-align: center; padding: 12px; background: #16213e; border-radius: 8px; }
  .stat .value { font-size: 1.8em; font-weight: bold; color: #e94560; }
  .stat .label { font-size: 0.8em; color: #aaa; margin-top: 4px; }
</style>
</head>
<body>
<div class="header">
  <h1>🎤 WWE Director — Live Control</h1>
  <div class="status">Status: <span id="statusText" class="live">LOADING...</span> | Messages: <span id="msgCount">0</span> | Uptime: <span id="uptime">0m</span></div>
</div>

<div class="grid">
  <!-- Stats -->
  <div class="card" style="grid-column: 1 / -1;">
    <div class="stats">
      <div class="stat"><div class="value" id="statActive">0</div><div class="label">Active Wrestlers</div></div>
      <div class="stat"><div class="value" id="statWings">0</div><div class="label">In the Wings</div></div>
      <div class="stat"><div class="value" id="statFeuds">0</div><div class="label">Active Feuds</div></div>
      <div class="stat"><div class="value" id="statMessages">0</div><div class="label">Total Messages</div></div>
    </div>
    <div class="controls">
      <button class="btn btn-red" onclick="togglePause()">⏸ Pause/Resume</button>
      <button class="btn btn-yellow" onclick="triggerSurprise()">💥 Surprise Entrance</button>
      <button class="btn btn-blue" onclick="refreshState()">🔄 Refresh</button>
    </div>
  </div>

  <!-- Characters -->
  <div class="card">
    <h2>🤼 Roster</h2>
    <div id="roster" class="character-grid"></div>
  </div>

  <!-- Championships -->
  <div class="card">
    <h2>🏆 Championships</h2>
    <div id="champList" style="display:grid; gap:8px;"></div>
    <div class="input-row" style="margin-top:12px;">
      <select id="champTitle"></select>
      <select id="champChar"></select>
      <button class="btn btn-yellow" onclick="awardTitle()">👑 Award Title</button>
    </div>
  </div>

  <!-- Feuds -->
  <div class="card">
    <h2>🔥 Active Feuds</h2>
    <ul id="feudList" class="feud-list"></ul>
    <div class="input-row" style="margin-top: 12px;">
      <select id="feudChar1"></select>
      <span style="padding:8px; color:#e94560; font-weight:bold;">VS</span>
      <select id="feudChar2"></select>
      <button class="btn btn-red" onclick="createFeud()">Start Feud</button>
    </div>
  </div>

  <!-- Match Simulator -->
  <div class="card">
    <h2>🤼 Book a Match</h2>
    <div class="input-row">
      <select id="matchChar1"></select>
      <span style="padding:8px; color:#e94560; font-weight:bold;">VS</span>
      <select id="matchChar2"></select>
    </div>
    <div class="input-row">
      <select id="matchType">
        <option value="singles">Singles</option>
        <option value="no-dq">No DQ</option>
        <option value="steel-cage">Steel Cage</option>
        <option value="hell-in-a-cell">Hell in a Cell</option>
        <option value="ladder">Ladder</option>
      </select>
      <select id="matchTitle"><option value="">No Title</option></select>
      <button class="btn btn-red" onclick="bookMatch()">🔔 BOOK IT!</button>
    </div>
    <div id="matchResult" style="margin-top:8px; font-style:italic; color:#aaa;"></div>
    <div id="matchHistory" style="margin-top:12px; max-height:150px; overflow-y:auto; font-size:0.85em;"></div>
  </div>

  <!-- Force Speak -->
  <div class="card">
    <h2>🎙️ Force Promo</h2>
    <div class="input-row">
      <select id="speakChar"></select>
      <input id="speakPrompt" placeholder="Custom prompt (optional)">
      <button class="btn btn-green" onclick="forceSpeak()">🗣️ Speak</button>
    </div>
    <div id="speakResult" style="margin-top:8px; font-style:italic; color:#aaa;"></div>
  </div>

  <!-- Recent History -->
  <div class="card">
    <h2>📝 Storyline Beats</h2>
    <div id="storyBeats" style="max-height:200px; overflow-y:auto; font-size:0.85em;"></div>
  </div>

  <!-- PPV Events -->
  <div class="card" style="grid-column: 1 / -1;">
    <h2>🎆 Pay-Per-View Events</h2>
    <div class="controls">
      <select id="ppvTemplate"></select>
      <button class="btn btn-red" onclick="schedulePPV()">📅 Schedule PPV</button>
    </div>
    <div id="ppvList" style="margin-top:12px;"></div>
  </div>

  <!-- Chat Log -->
  <div class="card" style="grid-column: 1 / -1;">
    <h2>💬 Chat Log</h2>
    <div id="chatLog" class="chat-log"></div>
  </div>
</div>

<script>
const API = '';
let state = null;
let characters = null;

async function fetchJSON(url, opts) {
  const r = await fetch(API + url, opts);
  return r.json();
}

let champData = null;

let ppvData = null;

async function refreshState() {
  [state, characters, champData, window._matchData, ppvData] = await Promise.all([
    fetchJSON('/state'),
    fetchJSON('/characters'),
    fetchJSON('/championships'),
    fetchJSON('/matches'),
    fetchJSON('/ppv'),
  ]);
  render();
}

function render() {
  if (!state || !characters) return;
  const s = state.state;
  
  // Status
  document.getElementById('statusText').textContent = state.paused ? 'PAUSED' : 'LIVE';
  document.getElementById('statusText').className = state.paused ? 'paused' : 'live';
  document.getElementById('msgCount').textContent = state.messages;
  document.getElementById('statActive').textContent = s.activeCharacters.length;
  document.getElementById('statWings').textContent = s.waitingInTheWings.length;
  document.getElementById('statFeuds').textContent = s.feuds.length;
  document.getElementById('statMessages').textContent = s.messageCount;
  
  const mins = Math.floor((Date.now() - s.sessionStartedAt) / 60000);
  document.getElementById('uptime').textContent = mins < 60 ? mins + 'm' : Math.floor(mins/60) + 'h ' + (mins%60) + 'm';
  
  // Roster
  const roster = document.getElementById('roster');
  roster.innerHTML = '';
  const charEntries = Object.entries(characters.characters);
  charEntries.forEach(([id, c]) => {
    const statusClass = c.active ? 'active' : c.inWings ? 'wings' : 'inactive';
    const statusLabel = c.active ? 'Active' : c.inWings ? 'In Wings' : 'Inactive';
    roster.innerHTML += \`<div class="char-card \${statusClass}" onclick="toggleCharacter('\${id}', \${c.active})">
      <div class="name">\${c.displayName}</div>
      <div class="alignment">\${c.alignment} · \${c.era}</div>
      <div class="heat">\${c.heat > 0 ? '🔥'.repeat(Math.min(c.heat, 5)) : ''}</div>
      <span class="status-badge \${statusClass}">\${statusLabel}</span>
    </div>\`;
  });
  
  // Feuds
  const feudList = document.getElementById('feudList');
  feudList.innerHTML = '';
  s.feuds.forEach(f => {
    const pct = (f.intensity / 10) * 100;
    const color = f.intensity > 7 ? '#ef4444' : f.intensity > 4 ? '#fbbf24' : '#4ade80';
    feudList.innerHTML += \`<li>
      <span>\${f.between[0]} <span class="vs">VS</span> \${f.between[1]}</span>
      <span class="intensity">\${f.intensity.toFixed(1)}/10
        <span class="intensity-bar"><span class="intensity-fill" style="width:\${pct}%; background:\${color};"></span></span>
      </span>
    </li>\`;
  });
  
  // Dropdowns
  const options = charEntries.map(([id, c]) => \`<option value="\${id}">\${c.name}</option>\`).join('');
  ['feudChar1','feudChar2','speakChar','champChar','matchChar1','matchChar2'].forEach(sel => {
    document.getElementById(sel).innerHTML = options;
  });
  
  // Championships
  const champList = document.getElementById('champList');
  if (champData?.championships) {
    champList.innerHTML = Object.entries(champData.championships).map(([id, c]) => {
      const holderName = c.holder ? (characters.characters[c.holder]?.name || c.holder) : 'VACANT';
      const color = c.holder ? '#4ade80' : '#666';
      return \`<div style="background:#16213e; border-radius:6px; padding:10px; display:flex; justify-content:space-between; align-items:center;">
        <div><strong>\${c.displayName}</strong></div>
        <div style="color:\${color}; font-weight:bold;">\${holderName}\${c.defenses > 0 ? ' ('+c.defenses+' defenses)' : ''}</div>
      </div>\`;
    }).join('');
    
    // Championship dropdowns
    const titleOpts = Object.entries(champData.championships).map(([id, c]) => \`<option value="\${id}">\${c.name}</option>\`).join('');
    document.getElementById('champTitle').innerHTML = titleOpts;
  }

  // PPV section
  if (ppvData) {
    const ppvTemplateSelect = document.getElementById('ppvTemplate');
    if (ppvData.templates) {
      ppvTemplateSelect.innerHTML = ppvData.templates.map(t => 
        \`<option value="\${t.id}">\${t.emoji} \${t.name}</option>\`
      ).join('');
    }
    
    const ppvList = document.getElementById('ppvList');
    let ppvHtml = '';
    
    if (ppvData.active) {
      ppvHtml += \`<div style="padding:12px; background:#1a0a0a; border:2px solid #e94560; border-radius:8px; margin-bottom:8px;">
        <strong style="color:#e94560;">🔴 LIVE: \${ppvData.active.emoji} \${ppvData.active.name}</strong>
        <div style="color:#aaa; font-size:0.85em;">\${ppvData.active.matchCard.length} matches · \${ppvData.active.results?.length || 0} completed</div>
      </div>\`;
    }
    
    for (const evt of (ppvData.scheduled || [])) {
      ppvHtml += \`<div style="padding:10px; background:#16213e; border-radius:8px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
        <div><strong>\${evt.emoji} \${evt.name}</strong> <span style="color:#aaa;">(\${evt.matchCard.length} matches)</span></div>
        <button class="btn btn-green" onclick="runPPVEvent('\${evt.id}')" style="padding:4px 12px; font-size:0.8em;">▶ RUN</button>
      </div>\`;
    }
    
    if ((ppvData.completed || []).length > 0) {
      ppvHtml += '<div style="margin-top:8px; color:#666; font-size:0.85em;">Recent:</div>';
      for (const evt of (ppvData.completed || []).slice(-3).reverse()) {
        ppvHtml += \`<div style="padding:6px; background:#0f0f1a; border-radius:4px; margin-bottom:4px; font-size:0.85em; color:#aaa;">
          \${evt.emoji} \${evt.name} — \${evt.results?.length || 0} matches
        </div>\`;
      }
    }
    
    ppvList.innerHTML = ppvHtml || '<div style="color:#666;">No events scheduled</div>';
  }

  // Match title dropdown
  if (champData?.championships) {
    const matchTitleSel = document.getElementById('matchTitle');
    matchTitleSel.innerHTML = '<option value="">No Title</option>' + 
      Object.entries(champData.championships).map(([id, c]) => \`<option value="\${id}">\${c.name}</option>\`).join('');
  }

  // Match history
  if (window._matchData?.recentMatches) {
    document.getElementById('matchHistory').innerHTML = window._matchData.recentMatches.slice(-5).reverse().map(m => {
      const names = m.participants.map(p => characters?.characters[p]?.name || p);
      const winner = characters?.characters[m.winner]?.name || m.winner;
      return \`<div style="padding:4px; margin-bottom:4px; background:#16213e; border-radius:4px;">
        <strong>\${names.join(' vs ')}</strong> — 🏆 \${winner} (${''}\${m.winMethod}, \${m.rounds} rds)
      </div>\`;
    }).join('');
  }

  // Story beats
  const beats = document.getElementById('storyBeats');
  beats.innerHTML = s.recentHistory.slice(-10).reverse().map(h => 
    \`<div style="margin-bottom:4px; padding:4px; background:#16213e; border-radius:4px;">
      <strong>\${h.beat}</strong> — \${h.characters.join(' vs ')}\${h.intensity ? ' (intensity: '+h.intensity+')' : ''}
    </div>\`
  ).join('');
}

async function loadChat() {
  const data = await fetchJSON('/history?limit=30');
  const log = document.getElementById('chatLog');
  log.innerHTML = data.messages.map(m => {
    const t = new Date(m.timestamp).toLocaleTimeString();
    const cls = m.isCharacter ? 'msg character' : 'msg';
    return \`<div class="\${cls}"><span class="time">\${t}</span> <span class="author">\${m.author}:</span> \${m.content}</div>\`;
  }).join('');
  log.scrollTop = log.scrollHeight;
}

async function togglePause() {
  const action = state?.paused ? '/resume' : '/pause';
  await fetchJSON(action, { method: 'POST' });
  refreshState();
}

async function triggerSurprise() {
  const r = await fetchJSON('/surprise', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' });
  if (r.ok) alert('💥 ' + r.character + ' enters! ' + (r.response || '').slice(0, 100));
  else alert('No characters in wings');
  refreshState();
}

async function forceSpeak() {
  const charId = document.getElementById('speakChar').value;
  const prompt = document.getElementById('speakPrompt').value;
  document.getElementById('speakResult').textContent = 'Generating...';
  const r = await fetchJSON('/speak', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ characterId: charId, prompt }) });
  document.getElementById('speakResult').textContent = r.response || 'No response';
  loadChat();
}

async function createFeud() {
  const c1 = document.getElementById('feudChar1').value;
  const c2 = document.getElementById('feudChar2').value;
  if (c1 === c2) { alert('Pick two different wrestlers'); return; }
  await fetchJSON('/feud', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ char1: c1, char2: c2, intensity: 5 }) });
  refreshState();
}

async function schedulePPV() {
  const templateId = document.getElementById('ppvTemplate').value;
  const r = await fetchJSON('/ppv/schedule', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ templateId }) });
  if (r.ok) {
    // Auto-book the card
    await fetchJSON('/ppv/' + r.event.id + '/auto-book', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    alert(r.event.emoji + ' ' + r.event.name + ' scheduled! Card auto-booked.');
  }
  refreshState();
}

async function runPPVEvent(eventId) {
  if (!confirm('Start this PPV? Matches will play out in Discord.')) return;
  const r = await fetchJSON('/ppv/' + eventId + '/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
  if (r.ok) alert('PPV STARTED! Check Discord.');
  else alert('Error: ' + (r.error || 'unknown'));
  refreshState();
}

async function bookMatch() {
  const c1 = document.getElementById('matchChar1').value;
  const c2 = document.getElementById('matchChar2').value;
  if (c1 === c2) { alert('Pick two different wrestlers'); return; }
  const matchType = document.getElementById('matchType').value;
  const forTitle = document.getElementById('matchTitle').value || undefined;
  document.getElementById('matchResult').textContent = 'Simulating match...';
  const r = await fetchJSON('/matches/simulate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ participants: [c1, c2], matchType, forTitle }) });
  if (r.ok) {
    const winner = characters?.characters[r.result.match.winner]?.name || r.result.match.winner;
    document.getElementById('matchResult').textContent = '🏆 Winner: ' + winner + ' (' + r.result.match.winMethod + ', ' + r.result.rounds.length + ' rounds)';
  } else {
    document.getElementById('matchResult').textContent = 'Error: ' + (r.error || 'unknown');
  }
  refreshState();
}

async function awardTitle() {
  const titleId = document.getElementById('champTitle').value;
  const characterId = document.getElementById('champChar').value;
  const r = await fetchJSON('/championships/award', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ titleId, characterId }) });
  if (r.ok) alert('👑 ' + (r.result.titleName) + ' awarded to ' + characterId);
  refreshState();
}

async function toggleCharacter(id, isActive) {
  await fetchJSON('/characters', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id, active: !isActive }) });
  refreshState();
}

// Auto-refresh
refreshState();
loadChat();
setInterval(refreshState, 5000);
setInterval(loadChat, 8000);
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// PPV Runner
// ---------------------------------------------------------------------------
async function runPPV(event) {
  const channel = discordClient?.channels?.cache?.get(CONFIG.channelId);
  if (!channel && !webhookClient) {
    console.error('No channel or webhook for PPV broadcast');
    ppvEngine.completeEvent();
    return;
  }

  const send = async (content, username = '📢 Ring Announcer') => {
    if (webhookClient) {
      await webhookClient.send({ content, username });
    } else if (channel) {
      await channel.send(content);
    }
  };

  // Pre-show hype
  const hypeMessages = ppvEngine.buildHypeMessages(event);
  for (const msg of hypeMessages) {
    await send(msg);
    await sleep(2000);
  }

  await sleep(5000);
  await send(`\n🔔 **THE SHOW IS ABOUT TO BEGIN!** 🔔\n${'═'.repeat(30)}`);
  await sleep(3000);

  // Run each match
  for (const matchEntry of event.matchCard) {
    await sleep(4000);

    // Match intro
    const names = matchEntry.participants.map(p => getCharacter(p)?.displayName || p);
    const typeLabel = matchEntry.matchType !== 'singles' ? ` [${matchEntry.matchType.toUpperCase()}]` : '';
    const titleLabel = matchEntry.forTitle ? ` for the ${matchEntry.forTitle}` : '';
    const mainLabel = matchEntry.isMainEvent ? '\n🌟 **THIS IS YOUR MAIN EVENT OF THE EVENING!** 🌟' : '';

    await send(`\n${'─'.repeat(30)}\n**MATCH ${matchEntry.order}${typeLabel}${titleLabel}**\n${names.join(' vs ')}${mainLabel}`);
    await sleep(3000);

    // Entrances
    for (const p of matchEntry.participants) {
      const char = getCharacter(p);
      if (char?.entranceMusic) {
        await send(`${char.entranceMusic}`);
        await sleep(2000);
      }
    }

    // Simulate the match
    const result = matchEngine.simulateFullMatch(
      matchEntry.participants,
      matchEntry.matchType,
      { forTitle: matchEntry.forTitle }
    );

    if (result.error) {
      await send(`⚠️ Match error: ${result.error}`);
      continue;
    }

    // Post match to Discord
    await postMatchToDiscord(result, channel);

    // Handle title change
    if (matchEntry.forTitle && result.match.winner) {
      const titleResult = championships.awardTitle(matchEntry.forTitle, result.match.winner, result.match.winMethod);
      result.titleChange = titleResult;
    }

    // Record result in PPV
    ppvEngine.recordMatchResult(matchEntry.order, {
      winner: result.match.winner,
      winMethod: result.match.winMethod,
      rounds: result.rounds.length,
      titleChange: !!result.titleChange,
    });

    // Pause between matches
    await sleep(6000);
  }

  // Event complete
  const completed = ppvEngine.completeEvent();
  if (completed) {
    await sleep(3000);
    const summary = ppvEngine.buildResultsSummary(completed);
    await send(`\n${'═'.repeat(30)}\n${summary}`);
  }

  // Save all state
  storyline.ppvData = ppvEngine.toJSON();
  storyline.championshipData = championships.toJSON();
  storyline.matchData = matchEngine.toJSON();
  await storyline.saveState();

  console.log(`PPV ${event.name} completed!`);
}

// ---------------------------------------------------------------------------
// Match Broadcast
// ---------------------------------------------------------------------------
async function postMatchToDiscord(result, channel) {
  const match = result.match;
  const type = match.typeEmoji || '🤼';
  const winnerChar = getCharacter(match.winner);
  
  // Opening card
  const participantNames = match.participants.map(p => getCharacter(p)?.displayName || p).join(' vs ');
  const opener = `${type} **${match.typeName || 'MATCH'}**\n${participantNames}\n${match.forTitle ? `*For the ${match.forTitle}*\n` : ''}🔔 **DING DING DING!**`;
  
  if (webhookClient) {
    await webhookClient.send({ content: opener, username: '📢 Ring Announcer' });
  } else {
    await channel.send(opener);
  }

  // Post key rounds (not all — just highlights)
  const highlights = result.rounds.filter(r => 
    ['near-fall', 'finisher-attempt', 'finisher-counter', 'near-fall-kickout', 
     'comeback', 'weapon-shot', 'ref-bump', 'outside-brawl'].includes(r.beat) || r.isFinish
  ).slice(-4); // Last 4 highlights max

  for (const round of highlights) {
    await sleep(2500 + Math.random() * 2000);
    const prompt = matchEngine.buildRoundPrompt(round);
    if (prompt) {
      if (webhookClient) {
        await webhookClient.send({ content: `> ${prompt.narrative}`, username: '📢 Ring Announcer' });
      } else {
        await channel.send(`> ${prompt.narrative}`);
      }
    }
  }

  // Crowd reaction after big moments
  if (shouldCrowdReact('awesome') && highlights.length >= 3) {
    await sleep(1500);
    const reaction = getMatchReaction('awesome');
    if (reaction) {
      if (webhookClient) {
        await webhookClient.send({ content: reaction, username: '👥 The Crowd' });
      } else if (channel) {
        await channel.send(reaction);
      }
    }
  }

  // Final result
  await sleep(2000);
  const winMethod = match.winMethod === 'pinfall' ? 'by pinfall' : 
    match.winMethod === 'submission' ? 'by submission' :
    match.winMethod === 'count-out' ? 'by count-out' :
    `by ${match.winMethod}`;
  
  const resultMsg = `🏆 **YOUR WINNER: ${winnerChar?.displayName || match.winner}!** (${winMethod} in ${result.rounds.length} rounds)`;
  if (webhookClient) {
    await webhookClient.send({ content: resultMsg, username: '📢 Ring Announcer' });
  } else {
    await channel.send(resultMsg);
  }

  // Title change announcement
  if (result.titleChange) {
    await sleep(1500);
    const titleMsg = `👑 **NEW ${result.titleChange.titleName.toUpperCase()} CHAMPION: ${winnerChar?.displayName || match.winner}!**`;
    if (webhookClient) {
      await webhookClient.send({ content: titleMsg, username: '📢 Ring Announcer' });
    } else {
      await channel.send(titleMsg);
    }
    // Crowd goes wild for title change
    if (shouldCrowdReact('titleChange')) {
      await sleep(1000);
      const crowdReaction = getMatchReaction('titleChange');
      if (crowdReaction) {
        if (webhookClient) {
          await webhookClient.send({ content: crowdReaction, username: '👥 The Crowd' });
        } else if (channel) {
          await channel.send(crowdReaction);
        }
      }
    }
  }

  // Announcer commentary on the finish
  triggerAnnouncerCommentary(
    result.titleChange ? 'title-change' : 'feud-escalation',
    `${winnerChar?.name} just defeated ${match.participants.filter(p => p !== match.winner).map(p => getCharacter(p)?.name || p).join(' and ')} in a ${match.typeName}!`,
    channel
  );

  // Winner reacts
  await sleep(3000);
  const winnerResponse = await generateResponse(
    { characterId: match.winner, context: `You just WON a ${match.typeName} ${winMethod}! ${result.titleChange ? 'AND you are the NEW champion!' : ''} Celebrate!`, reason: 'match-win' },
    'The bell rings. The match is over.',
    messageHistory
  );
  if (winnerResponse) {
    await sendAsCharacter(match.winner, winnerResponse, channel);
  }

  // Loser reacts
  const loser = match.participants.find(p => p !== match.winner);
  if (loser) {
    await sleep(2500);
    const loserResponse = await generateResponse(
      { characterId: loser, context: `You just LOST a ${match.typeName} ${winMethod}. ${result.titleChange ? 'You lost your title!' : ''} React.`, reason: 'match-loss' },
      'The bell rings. The match is over.',
      messageHistory
    );
    if (loserResponse) {
      await sendAsCharacter(loser, loserResponse, channel);
    }
  }
}

// ---------------------------------------------------------------------------
// Announcer Commentary
// ---------------------------------------------------------------------------
async function triggerAnnouncerCommentary(eventType, contextText, channel) {
  const reactingAnnouncers = getAnnouncerReactions(eventType);
  for (const announcerId of reactingAnnouncers) {
    const prompt = buildAnnouncerPrompt(announcerId, eventType, contextText);
    if (!prompt) continue;

    await sleep(1500 + Math.random() * 2000);

    try {
      const response = await fetch(`${CONFIG.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: CONFIG.model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.prompt },
          ],
          stream: false,
          options: { temperature: 0.9, top_p: 0.95, num_predict: 100 },
        }),
      });
      const data = await response.json();
      const text = (data.message?.content || '').trim().slice(0, 300);
      if (!text) continue;

      if (webhookClient) {
        await webhookClient.send({ content: text, username: prompt.displayName, avatarURL: prompt.avatar });
      } else if (channel) {
        await channel.send(`**${prompt.displayName}:** ${text}`);
      }
    } catch (err) {
      console.error(`Announcer ${announcerId} error:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('🎤 WWE Discord Director starting...');
  console.log(`Characters: ${listCharacters().join(', ')}`);
  console.log(`Model: ${CONFIG.model}`);
  
  // Load persisted storyline state
  await storyline.loadState();
  
  // Load championship + match state if saved
  if (storyline.championshipData) {
    championships.loadFrom(storyline.championshipData);
    console.log('Loaded championship state');
  }
  if (storyline.matchData) {
    matchEngine.loadFrom(storyline.matchData);
    console.log(`Loaded match history: ${matchEngine.matchHistory.length} matches`);
  }
  if (storyline.ppvData) {
    ppvEngine.loadFrom(storyline.ppvData);
    console.log(`Loaded PPV data: ${ppvEngine.scheduledEvents.length} scheduled, ${ppvEngine.completedEvents.length} completed`);
  }
  
  startAPI();
  await startDiscord();
  startPromoSchedule();
  
  // Save state on exit
  process.on('SIGTERM', async () => { await storyline.saveState(); process.exit(0); });
  process.on('SIGINT', async () => { await storyline.saveState(); process.exit(0); });
  
  console.log('🎤 Director is LIVE. The show has begun.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
