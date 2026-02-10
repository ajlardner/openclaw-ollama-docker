/**
 * WWE Storyline Engine
 * 
 * Manages ongoing feuds, surprise appearances, events, and narrative arcs.
 * Think of this as the "booker" — it decides what happens and when.
 */

import { getCharacter, listCharacters, getFeudPartners } from './characters.js';

const STORYLINE_BEATS = {
  feud: [
    { type: 'trash-talk', description: 'Characters exchange insults', weight: 40 },
    { type: 'challenge', description: 'One character challenges another', weight: 20 },
    { type: 'alliance-tease', description: 'Hint at a possible team-up', weight: 10 },
    { type: 'backstory', description: 'Reference past matches or history', weight: 15 },
    { type: 'escalation', description: 'The feud gets more intense', weight: 15 },
  ],
  
  surprise: [
    { type: 'entrance', description: 'New character makes a dramatic entrance', weight: 30 },
    { type: 'interruption', description: 'Character interrupts a conversation', weight: 30 },
    { type: 'save', description: 'Character saves someone from a beatdown', weight: 20 },
    { type: 'betrayal', description: 'Character turns on an ally', weight: 10 },
    { type: 'return', description: 'Character returns after being absent', weight: 10 },
  ],
  
  event: [
    { type: 'promo', description: 'Character cuts a promo (monologue)', weight: 30 },
    { type: 'segment', description: 'A scripted interaction between characters', weight: 25 },
    { type: 'match-announcement', description: 'Announce an upcoming match', weight: 20 },
    { type: 'backstage', description: 'Backstage scene between characters', weight: 15 },
    { type: 'crowd-work', description: 'Character interacts with the audience', weight: 10 },
  ],
};

export class StorylineEngine {
  constructor() {
    this.activeFeud = { between: ['john-cena', 'the-rock'], intensity: 7, startedAt: Date.now() };
    this.storylineHistory = [];
    this.beatsSinceLastSurprise = 0;
    this.activeCharacters = ['john-cena', 'the-rock']; // Characters currently "in the building"
    this.waitingInTheWings = ['stone-cold']; // Characters that can make surprise entrances
    this.messageCount = 0;
  }
  
  /**
   * Decide which characters should respond to a message
   * Returns array of { characterId, reason, prompt }
   */
  decideResponders(message, authorCharacterId = null) {
    const responders = [];
    this.messageCount++;
    this.beatsSinceLastSurprise++;
    
    for (const charId of this.activeCharacters) {
      // Don't respond to yourself
      if (charId === authorCharacterId) continue;
      
      const char = getCharacter(charId);
      if (!char) continue;
      
      const feudPartners = getFeudPartners(charId);
      const isFeudRelated = authorCharacterId && feudPartners.includes(authorCharacterId);
      
      // Determine response probability
      let chance = char.responseChance;
      if (isFeudRelated) chance = char.feudResponseChance;
      
      // Boost chance if directly mentioned
      if (message.toLowerCase().includes(char.name.toLowerCase())) {
        chance = Math.min(1.0, chance + 0.3);
      }
      
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
      }
    }
    
    // Check for surprise entrance
    if (this.shouldTriggerSurprise()) {
      const surprise = this.triggerSurprise();
      if (surprise) {
        responders.push(surprise);
      }
    }
    
    return responders;
  }
  
  /**
   * Generate context for a feud interaction
   */
  generateFeudContext(charId, opponentId) {
    const beats = STORYLINE_BEATS.feud;
    const beat = this.weightedRandom(beats);
    
    const char = getCharacter(charId);
    const opponent = getCharacter(opponentId);
    
    const contexts = {
      'trash-talk': `You're in the middle of a heated feud with ${opponent.name}. Trash talk them. Be creative and in-character. Reference your history.`,
      'challenge': `Challenge ${opponent.name} to a match. Make it dramatic. The crowd should go wild.`,
      'alliance-tease': `Hint that maybe you and ${opponent.name} could team up against a common enemy. But don't commit.`,
      'backstory': `Reference a past encounter with ${opponent.name}. Could be a famous match, a backstage confrontation, or something from your shared history.`,
      'escalation': `The feud with ${opponent.name} is getting more personal. Take it up a notch. Maybe threaten their championship, mock their catchphrase, or bring up something that really gets under their skin.`,
    };
    
    this.storylineHistory.push({
      timestamp: Date.now(),
      beat: beat.type,
      characters: [charId, opponentId],
    });
    
    return contexts[beat.type] || '';
  }
  
  /**
   * Should a surprise entrance happen?
   */
  shouldTriggerSurprise() {
    if (this.waitingInTheWings.length === 0) return false;
    if (this.beatsSinceLastSurprise < 10) return false; // At least 10 messages between surprises
    
    // Increasing probability as messages pass
    const chance = Math.min(0.3, (this.beatsSinceLastSurprise - 10) * 0.02);
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
    
    // Move from wings to active
    this.waitingInTheWings = this.waitingInTheWings.filter(c => c !== charId);
    this.activeCharacters.push(charId);
    this.beatsSinceLastSurprise = 0;
    
    const surpriseType = this.weightedRandom(STORYLINE_BEATS.surprise);
    
    const entrancePrompts = {
      'entrance': `*glass shatters* / *music hits* — You're making your DRAMATIC ENTRANCE into this conversation. Nobody expected you. React to what's been happening and make your presence known. This is a big moment.`,
      'interruption': `You're interrupting whatever is going on right now. You have something to say and you don't care who was talking. Cut in dramatically.`,
      'save': `Someone is getting ganged up on or beaten down verbally. You're here to even the odds. Make a dramatic save.`,
      'betrayal': `You were thought to be allied with someone here, but you're turning on them RIGHT NOW. Shocking heel turn.`,
      'return': `You've been gone for a while and you're BACK. Make it count. The crowd should lose their minds.`,
    };
    
    this.storylineHistory.push({
      timestamp: Date.now(),
      beat: `surprise-${surpriseType.type}`,
      characters: [charId],
    });
    
    return {
      characterId: charId,
      reason: `surprise-${surpriseType.type}`,
      context: entrancePrompts[surpriseType.type] || entrancePrompts.entrance,
      isSurprise: true,
    };
  }
  
  /**
   * Generate a promo prompt (for scheduled events)
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
    ].filter(Boolean);
    
    return promoTypes[Math.floor(Math.random() * promoTypes.length)];
  }
  
  /**
   * Add a character to the waiting list (for future surprise entrance)
   */
  addCharacterToWings(characterId) {
    if (!this.waitingInTheWings.includes(characterId) && !this.activeCharacters.includes(characterId)) {
      this.waitingInTheWings.push(characterId);
    }
  }
  
  /**
   * Get current storyline state
   */
  getState() {
    return {
      activeFeud: this.activeFeud,
      activeCharacters: this.activeCharacters,
      waitingInTheWings: this.waitingInTheWings,
      messageCount: this.messageCount,
      beatsSinceLastSurprise: this.beatsSinceLastSurprise,
      recentHistory: this.storylineHistory.slice(-20),
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
