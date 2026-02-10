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
 * 
 * This means you only need ONE Discord bot, not one per character.
 */

import { Client, GatewayIntentBits, WebhookClient } from 'discord.js';
import express from 'express';
import { CHARACTERS, getCharacter, listCharacters } from './characters.js';
import { StorylineEngine } from './storyline-engine.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CONFIG = {
  discordToken: process.env.DISCORD_BOT_TOKEN,
  ollamaUrl: process.env.OLLAMA_URL || 'http://ollama:11434',
  model: process.env.OLLAMA_MODEL || 'qwen3-coder',
  guildId: process.env.DISCORD_GUILD_ID,
  channelId: process.env.DISCORD_CHANNEL_ID,  // main channel to operate in
  webhookUrl: process.env.DISCORD_WEBHOOK_URL, // webhook for posting as characters
  apiPort: parseInt(process.env.DIRECTOR_PORT || '9091'),
  
  // Timing
  responseDelayMs: parseInt(process.env.RESPONSE_DELAY_MS || '3000'),  // feel more natural
  typingDelayPerChar: parseInt(process.env.TYPING_DELAY_PER_CHAR || '30'), // ms per character
  maxResponseLength: parseInt(process.env.MAX_RESPONSE_LENGTH || '500'),
  
  // Promos
  promoIntervalMinutes: parseInt(process.env.PROMO_INTERVAL_MIN || '30'),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const storyline = new StorylineEngine();
let webhookClient = null;
let discordClient = null;
const messageHistory = []; // Last N messages for context
const MAX_HISTORY = 20;

// ---------------------------------------------------------------------------
// Discord Bot Setup
// ---------------------------------------------------------------------------
async function startDiscord() {
  if (!CONFIG.discordToken) {
    console.error('DISCORD_BOT_TOKEN is required');
    process.exit(1);
  }
  
  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  
  // Set up webhook client
  if (CONFIG.webhookUrl) {
    webhookClient = new WebhookClient({ url: CONFIG.webhookUrl });
  }
  
  discordClient.on('ready', () => {
    console.log(`Discord bot logged in as ${discordClient.user.tag}`);
    console.log(`Watching guild: ${CONFIG.guildId}, channel: ${CONFIG.channelId}`);
  });
  
  discordClient.on('messageCreate', async (message) => {
    // Ignore our own webhook messages and bot messages
    if (message.webhookId) return;
    if (message.author.bot && message.author.id === discordClient.user.id) return;
    
    // Only respond in configured channel
    if (CONFIG.channelId && message.channel.id !== CONFIG.channelId) return;
    
    // Track message
    messageHistory.push({
      author: message.author.username,
      content: message.content,
      timestamp: Date.now(),
    });
    if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
    
    // Determine if any character posted this (check if it's a known character webhook)
    const authorCharacterId = identifyCharacter(message.author.username);
    
    // Ask storyline engine who should respond
    const responders = storyline.decideResponders(message.content, authorCharacterId);
    
    if (responders.length === 0) return;
    
    // Generate and send responses with natural delays
    for (const responder of responders) {
      // Natural delay before responding
      const delay = CONFIG.responseDelayMs + Math.random() * 2000;
      await sleep(delay);
      
      // Show typing indicator
      try { await message.channel.sendTyping(); } catch (e) {}
      
      // Generate response
      const response = await generateResponse(responder, message.content, messageHistory);
      if (!response) continue;
      
      // Typing delay proportional to message length
      const typingDelay = Math.min(response.length * CONFIG.typingDelayPerChar, 5000);
      await sleep(typingDelay);
      
      // Send via webhook
      await sendAsCharacter(responder.characterId, response, message.channel);
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
  
  // Build conversation context
  const recentMessages = history.slice(-10).map(m => 
    `${m.author}: ${m.content}`
  ).join('\n');
  
  const systemPrompt = char.personality;
  
  let userPrompt = `Here's the recent conversation in the Discord server:\n\n${recentMessages}\n\n`;
  
  if (responder.context) {
    userPrompt += `STORYLINE DIRECTION: ${responder.context}\n\n`;
  }
  
  if (responder.isSurprise) {
    userPrompt += `THIS IS YOUR DRAMATIC ENTRANCE. Make it memorable.\n\n`;
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
        options: {
          temperature: 0.9,      // Creative responses
          top_p: 0.95,
          num_predict: 200,      // Keep responses short
        },
      }),
    });
    
    const data = await response.json();
    let text = data.message?.content || '';
    
    // Truncate if too long
    if (text.length > CONFIG.maxResponseLength) {
      text = text.slice(0, CONFIG.maxResponseLength).trim();
      // Try to end at a sentence
      const lastPeriod = text.lastIndexOf('.');
      const lastExclaim = text.lastIndexOf('!');
      const lastQuestion = text.lastIndexOf('?');
      const lastEnd = Math.max(lastPeriod, lastExclaim, lastQuestion);
      if (lastEnd > text.length * 0.5) {
        text = text.slice(0, lastEnd + 1);
      }
    }
    
    return text.trim();
  } catch (err) {
    console.error(`Ollama error for ${char.name}:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Send Message as Character (via Webhook)
// ---------------------------------------------------------------------------
async function sendAsCharacter(characterId, content, channel) {
  const char = getCharacter(characterId);
  if (!char || !content) return;
  
  try {
    if (webhookClient) {
      // Use webhook — posts with character's name and avatar
      await webhookClient.send({
        content,
        username: char.displayName,
        avatarURL: char.avatar,
      });
    } else {
      // Fallback: post as bot with character prefix
      await channel.send(`**${char.displayName}:** ${content}`);
    }
    
    // Track in history
    messageHistory.push({
      author: char.name,
      content,
      timestamp: Date.now(),
      isCharacter: true,
    });
    if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
    
    console.log(`[${char.name}] ${content.slice(0, 80)}...`);
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
    // Pick a random active character
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
    
    if (response && CONFIG.channelId) {
      const channel = discordClient?.channels?.cache?.get(CONFIG.channelId);
      if (channel) {
        await sendAsCharacter(charId, response, channel);
      }
    }
  }, CONFIG.promoIntervalMinutes * 60 * 1000);
  
  console.log(`Promo schedule: every ${CONFIG.promoIntervalMinutes} minutes`);
}

// ---------------------------------------------------------------------------
// API Server (for external control)
// ---------------------------------------------------------------------------
function startAPI() {
  const app = express();
  app.use(express.json());
  
  // Get storyline state
  app.get('/state', (req, res) => {
    res.json({ ok: true, state: storyline.getState(), messageCount: messageHistory.length });
  });
  
  // Force a character to speak
  app.post('/speak', async (req, res) => {
    const { characterId, prompt } = req.body;
    if (!characterId) return res.status(400).json({ error: 'characterId required' });
    
    const response = await generateResponse(
      { characterId, context: prompt || 'Say something in character.', reason: 'forced' },
      messageHistory.slice(-1)[0]?.content || '',
      messageHistory
    );
    
    if (response && CONFIG.channelId) {
      const channel = discordClient?.channels?.cache?.get(CONFIG.channelId);
      if (channel) await sendAsCharacter(characterId, response, channel);
    }
    
    res.json({ ok: true, character: characterId, response });
  });
  
  // Trigger surprise entrance
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
    
    if (response && CONFIG.channelId) {
      const channel = discordClient?.channels?.cache?.get(CONFIG.channelId);
      if (channel) await sendAsCharacter(surprise.characterId, response, channel);
    }
    
    res.json({ ok: true, character: surprise.characterId, response });
  });
  
  // Add character to roster
  app.post('/characters', (req, res) => {
    const { id, active } = req.body;
    if (!id || !getCharacter(id)) return res.status(400).json({ error: 'Unknown character' });
    
    if (active) {
      if (!storyline.getState().activeCharacters.includes(id)) {
        storyline.activeCharacters.push(id);
      }
    } else {
      storyline.addCharacterToWings(id);
    }
    
    res.json({ ok: true, state: storyline.getState() });
  });
  
  // List characters
  app.get('/characters', (req, res) => {
    const chars = {};
    for (const [id, char] of Object.entries(CHARACTERS)) {
      chars[id] = {
        name: char.name,
        displayName: char.displayName,
        alignment: char.alignment,
        active: storyline.getState().activeCharacters.includes(id),
        inWings: storyline.getState().waitingInTheWings.includes(id),
      };
    }
    res.json({ ok: true, characters: chars });
  });
  
  app.listen(CONFIG.apiPort, '0.0.0.0', () => {
    console.log(`Director API listening on :${CONFIG.apiPort}`);
  });
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
  
  startAPI();
  await startDiscord();
  startPromoSchedule();
  
  console.log('🎤 Director is LIVE. The show has begun.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
