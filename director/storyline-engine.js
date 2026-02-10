/**
 * WWE Storyline Engine
 * 
 * Manages ongoing feuds, surprise appearances, events, and narrative arcs.
 * Think of this as the "booker" — it decides what happens and when.
 * 
 * Now with persistence — saves state to disk so storylines survive restarts.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { getCharacter, listCharacters, getFeudPartners, getAllFeuds } from './characters.js';

const STATE_DIR = process.env.STATE_DIR || '/data/storyline';
const STATE_FILE = `${STATE_DIR}/state.json`;
const HISTORY_FILE = `${STATE_DIR}/history.jsonl`;

const STORYLINE_BEATS = {
  feud: [
    { type: 'trash-talk', description: 'Characters exchange insults', weight: 35 },
    { type: 'challenge', description: 'One character challenges another', weight: 15 },
    { type: 'alliance-tease', description: 'Hint at a possible team-up', weight: 10 },
    { type: 'backstory', description: 'Reference past matches or history', weight: 15 },
    { type: 'escalation', description: 'The feud gets more intense', weight: 15 },
    { type: 'mind-games', description: 'Psychological warfare', weight: 10 },
  ],
  
  surprise: [
    { type: 'entrance', description: 'New character makes a dramatic entrance', weight: 30 },
    { type: 'interruption', description: 'Character interrupts a conversation', weight: 30 },
    { type: 'save', description: 'Character saves someone from a beatdown', weight: 15 },
    { type: 'betrayal', description: 'Character turns on an ally', weight: 10 },
    { type: 'return', description: 'Character returns after being absent', weight: 10 },
    { type: 'run-in', description: 'Character attacks from behind', weight: 5 },
  ],
  
  event: [
    { type: 'promo', description: 'Character cuts a promo (monologue)', weight: 25 },
    { type: 'segment', description: 'A scripted interaction between characters', weight: 20 },
    { type: 'match-announcement', description: 'Announce an upcoming match', weight: 15 },
    { type: 'backstage', description: 'Backstage scene between characters', weight: 15 },
    { type: 'crowd-work', description: 'Character interacts with the audience', weight: 10 },
    { type: 'contract-signing', description: 'Characters face off at a contract signing', weight: 5 },
  ],
};

export class StorylineEngine {
  constructor() {
    // Active feuds with intensity tracking
    this.feuds = [
      { between: ['john-cena', 'the-rock'], intensity: 7, phase: 'building', startedAt: Date.now() },
      { between: ['stone-cold', 'triple-h'], intensity: 6, phase: 'building', startedAt: Date.now() },
      { between: ['undertaker', 'mankind'], intensity: 5, phase: 'simmering', startedAt: Date.now() },
    ];
    this.storylineHistory = [];
    this.beatsSinceLastSurprise = 0;
    this.activeCharacters = ['john-cena', 'the-rock'];
    this.waitingInTheWings = ['stone-cold', 'undertaker', 'macho-man', 'triple-h', 'mankind'];
    this.messageCount = 0;
    this.sessionStartedAt = Date.now();
    
    // Alignment tracking — characters can turn heel/face over time
    this.alignmentOverrides = {};
    
    // Relationship heat map — how much two characters have interacted recently
    this.heatMap = {};
    
    // Loaded flag
    this._loaded = false;
  }
  
  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------
  
  async loadState() {
    try {
      if (!existsSync(STATE_FILE)) {
        console.log('No saved storyline state — starting fresh');
        this._loaded = true;
        return;
      }
      
      const raw = await readFile(STATE_FILE, 'utf-8');
      const saved = JSON.parse(raw);
      
      if (saved.feuds) this.feuds = saved.feuds;
      if (saved.activeCharacters) this.activeCharacters = saved.activeCharacters;
      if (saved.waitingInTheWings) this.waitingInTheWings = saved.waitingInTheWings;
      if (saved.messageCount) this.messageCount = saved.messageCount;
      if (saved.beatsSinceLastSurprise) this.beatsSinceLastSurprise = saved.beatsSinceLastSurprise;
      if (saved.alignmentOverrides) this.alignmentOverrides = saved.alignmentOverrides;
      if (saved.heatMap) this.heatMap = saved.heatMap;
      if (saved.storylineHistory) this.storylineHistory = saved.storylineHistory.slice(-100);
      
      console.log(`Loaded storyline state: ${this.messageCount} messages, ${this.feuds.length} feuds, ${this.activeCharacters.length} active characters`);
      this._loaded = true;
    } catch (err) {
      console.error('Failed to load storyline state:', err.message);
      this._loaded = true;
    }
  }
  
  async saveState() {
    try {
      if (!existsSync(STATE_DIR)) {
        await mkdir(STATE_DIR, { recursive: true });
      }
      
      const state = {
        savedAt: new Date().toISOString(),
        feuds: this.feuds,
        activeCharacters: this.activeCharacters,
        waitingInTheWings: this.waitingInTheWings,
        messageCount: this.messageCount,
        beatsSinceLastSurprise: this.beatsSinceLastSurprise,
        alignmentOverrides: this.alignmentOverrides,
        heatMap: this.heatMap,
        storylineHistory: this.storylineHistory.slice(-100),
      };
      
      await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('Failed to save storyline state:', err.message);
    }
  }
  
  async appendHistory(entry) {
    try {
      if (!existsSync(STATE_DIR)) {
        await mkdir(STATE_DIR, { recursive: true });
      }
      const line = JSON.stringify({ ...entry, timestamp: Date.now() }) + '\n';
      const { appendFile: appendF } = await import('fs/promises');
      await appendF(HISTORY_FILE, line);
    } catch (err) {
      // Non-critical
    }
  }
  
  // -----------------------------------------------------------------------
  // Core Logic
  // -----------------------------------------------------------------------
  
  /**
   * Decide which characters should respond to a message
   */
  decideResponders(message, authorCharacterId = null) {
    const responders = [];
    this.messageCount++;
    this.beatsSinceLastSurprise++;
    
    // Update heat map
    if (authorCharacterId) {
      this.updateHeat(authorCharacterId);
    }
    
    for (const charId of this.activeCharacters) {
      if (charId === authorCharacterId) continue;
      
      const char = getCharacter(charId);
      if (!char) continue;
      
      const feudPartners = getFeudPartners(charId);
      const isFeudRelated = authorCharacterId && feudPartners.includes(authorCharacterId);
      
      let chance = char.responseChance;
      if (isFeudRelated) chance = char.feudResponseChance;
      
      // Boost if directly mentioned
      const nameParts = char.name.toLowerCase().split(' ');
      const msgLower = message.toLowerCase();
      if (nameParts.some(part => msgLower.includes(part))) {
        chance = Math.min(1.0, chance + 0.3);
      }
      
      // Reduce chance if character has been very active (cooldown effect)
      const heat = this.getHeat(charId);
      if (heat > 5) chance *= 0.7;
      if (heat > 10) chance *= 0.5;
      
      if (Math.random() < chance) {
        let context = '';
        if (isFeudRelated) {
          context = this.generateFeudContext(charId, authorCharacterId);
        }
        
        responders.push({
          characterId: charId,
          reason: isFeudRelated ? 'feud-response' : 'general-response',
          context,
        });
        
        this.updateHeat(charId);
      }
    }
    
    // Check for surprise entrance
    if (this.shouldTriggerSurprise()) {
      const surprise = this.triggerSurprise();
      if (surprise) responders.push(surprise);
    }
    
    // Auto-save every 10 messages
    if (this.messageCount % 10 === 0) {
      this.saveState().catch(() => {});
    }
    
    return responders;
  }
  
  /**
   * Track interaction heat for a character
   */
  updateHeat(charId) {
    const now = Date.now();
    if (!this.heatMap[charId]) this.heatMap[charId] = [];
    this.heatMap[charId].push(now);
    // Keep only last 30 minutes
    const cutoff = now - 30 * 60 * 1000;
    this.heatMap[charId] = this.heatMap[charId].filter(t => t > cutoff);
  }
  
  getHeat(charId) {
    if (!this.heatMap[charId]) return 0;
    const cutoff = Date.now() - 30 * 60 * 1000;
    this.heatMap[charId] = this.heatMap[charId].filter(t => t > cutoff);
    return this.heatMap[charId].length;
  }
  
  /**
   * Generate context for a feud interaction
   */
  generateFeudContext(charId, opponentId) {
    const beats = STORYLINE_BEATS.feud;
    const beat = this.weightedRandom(beats);
    
    const char = getCharacter(charId);
    const opponent = getCharacter(opponentId);
    
    // Find the feud and get its intensity
    const feud = this.feuds.find(f => 
      f.between.includes(charId) && f.between.includes(opponentId)
    );
    const intensity = feud?.intensity || 5;
    
    const contexts = {
      'trash-talk': `You're in the middle of a heated feud with ${opponent.name}. Trash talk them. Be creative and in-character. Reference your history. Intensity: ${intensity}/10.`,
      'challenge': `Challenge ${opponent.name} to a match. Make it dramatic. The crowd should go wild.`,
      'alliance-tease': `Hint that maybe you and ${opponent.name} could team up against a common enemy. But don't commit — keep them guessing.`,
      'backstory': `Reference a past encounter with ${opponent.name}. Could be a famous match, a backstage confrontation, or something from your shared history.`,
      'escalation': `The feud with ${opponent.name} is getting more personal. Take it up a notch. Maybe threaten their championship, mock their catchphrase, or bring up something that really gets under their skin. Intensity: ${intensity}/10.`,
      'mind-games': `Play mind games with ${opponent.name}. Get inside their head. Be subtle and psychological — make them doubt themselves.`,
    };
    
    // Escalate feud intensity
    if (feud && intensity < 10) {
      feud.intensity = Math.min(10, intensity + 0.3);
    }
    
    const entry = {
      beat: beat.type,
      characters: [charId, opponentId],
      intensity,
    };
    this.storylineHistory.push(entry);
    this.appendHistory(entry).catch(() => {});
    
    return contexts[beat.type] || '';
  }
  
  /**
   * Should a surprise entrance happen?
   */
  shouldTriggerSurprise() {
    if (this.waitingInTheWings.length === 0) return false;
    if (this.beatsSinceLastSurprise < 8) return false;
    
    const chance = Math.min(0.35, (this.beatsSinceLastSurprise - 8) * 0.025);
    return Math.random() < chance;
  }
  
  /**
   * Trigger a surprise entrance
   */
  triggerSurprise() {
    if (this.waitingInTheWings.length === 0) return null;
    
    const charId = this.waitingInTheWings[Math.floor(Math.random() * this.waitingInTheWings.length)];
    const char = getCharacter(charId);
    if (!char) return null;
    
    this.waitingInTheWings = this.waitingInTheWings.filter(c => c !== charId);
    this.activeCharacters.push(charId);
    this.beatsSinceLastSurprise = 0;
    
    const surpriseType = this.weightedRandom(STORYLINE_BEATS.surprise);
    
    const entrancePrompts = {
      'entrance': `${char.entranceMusic || '*music hits*'} — You're making your DRAMATIC ENTRANCE. Nobody expected you. React to what's been happening and make your presence known.`,
      'interruption': `You're interrupting whatever is going on right now. You have something to say and you don't care who was talking. Cut in dramatically.`,
      'save': `Someone is getting ganged up on or beaten down verbally. You're here to even the odds. Make a dramatic save.`,
      'betrayal': `You were thought to be allied with someone here, but you're turning on them RIGHT NOW. Shocking heel turn.`,
      'return': `You've been gone for a while and you're BACK. ${char.entranceMusic || '*music hits*'} Make it count.`,
      'run-in': `You're attacking from behind! Nobody saw you coming. Pick a target and lay them out.`,
    };
    
    const entry = {
      beat: `surprise-${surpriseType.type}`,
      characters: [charId],
    };
    this.storylineHistory.push(entry);
    this.appendHistory(entry).catch(() => {});
    
    return {
      characterId: charId,
      reason: `surprise-${surpriseType.type}`,
      context: entrancePrompts[surpriseType.type] || entrancePrompts.entrance,
      isSurprise: true,
    };
  }
  
  /**
   * Generate a promo prompt
   */
  generatePromo(characterId) {
    const char = getCharacter(characterId);
    if (!char) return null;
    
    const feudPartners = getFeudPartners(characterId);
    const opponent = feudPartners.length > 0 ? getCharacter(feudPartners[0]) : null;
    
    const promoTypes = [
      `Cut a promo about why you're the greatest of all time. Address the crowd directly. Build hype.`,
      opponent ? `Cut a promo calling out ${opponent.name}. Challenge them. Get the crowd going.` : null,
      `Tell a story from your career. Make it dramatic and entertaining.`,
      `React to what's been happening in this Discord server. Give your take on the other characters.`,
      `Hype up an upcoming confrontation. Build suspense.`,
      `Address the fans directly. What does being a WWE superstar mean to you?`,
      opponent ? `Respond to something ${opponent.name} said recently. Don't let them get the last word.` : null,
    ].filter(Boolean);
    
    return promoTypes[Math.floor(Math.random() * promoTypes.length)];
  }
  
  /**
   * Create a new feud
   */
  createFeud(char1, char2, intensity = 5) {
    const existing = this.feuds.find(f => 
      f.between.includes(char1) && f.between.includes(char2)
    );
    if (existing) {
      existing.intensity = intensity;
      existing.phase = 'building';
      return existing;
    }
    const feud = { between: [char1, char2], intensity, phase: 'building', startedAt: Date.now() };
    this.feuds.push(feud);
    this.saveState().catch(() => {});
    return feud;
  }
  
  /**
   * Add a character to the waiting list
   */
  addCharacterToWings(characterId) {
    if (!this.waitingInTheWings.includes(characterId) && !this.activeCharacters.includes(characterId)) {
      this.waitingInTheWings.push(characterId);
    }
  }
  
  /**
   * Remove a character from active roster
   */
  deactivateCharacter(characterId) {
    this.activeCharacters = this.activeCharacters.filter(c => c !== characterId);
    this.waitingInTheWings = this.waitingInTheWings.filter(c => c !== characterId);
    this.saveState().catch(() => {});
  }
  
  /**
   * Get current storyline state
   */
  getState() {
    return {
      feuds: this.feuds,
      activeCharacters: this.activeCharacters,
      waitingInTheWings: this.waitingInTheWings,
      messageCount: this.messageCount,
      beatsSinceLastSurprise: this.beatsSinceLastSurprise,
      heatMap: Object.fromEntries(
        Object.entries(this.heatMap).map(([k, v]) => [k, v.length])
      ),
      recentHistory: this.storylineHistory.slice(-20),
      sessionStartedAt: this.sessionStartedAt,
    };
  }
  
  /**
   * Weighted random selection
   */
  weightedRandom(items) {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let random = Math.random() * totalWeight;
    for (const item of items) {
      random -= item.weight;
      if (random <= 0) return item;
    }
    return items[items.length - 1];
  }
}
