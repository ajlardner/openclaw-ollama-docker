/**
 * WWE Match Simulation Engine
 * 
 * Simulates matches between characters with dramatic commentary beats.
 * Matches play out over multiple messages in Discord, building tension.
 * 
 * Match types: singles, tag team, triple threat, fatal four-way, royal rumble,
 * steel cage, hell in a cell, ladder, tables
 * 
 * Win conditions: pinfall, submission, count-out, DQ, escape (cage),
 * retrieve (ladder), table break
 */

import { getCharacter } from './characters.js';

const MATCH_TYPES = {
  singles: {
    name: 'Singles Match',
    emoji: '🤼',
    participants: 2,
    winConditions: ['pinfall', 'submission', 'count-out', 'dq'],
    rounds: { min: 4, max: 7 },
  },
  'no-dq': {
    name: 'No Disqualification Match',
    emoji: '⚠️',
    participants: 2,
    winConditions: ['pinfall', 'submission'],
    rounds: { min: 5, max: 8 },
    weaponsAllowed: true,
  },
  'steel-cage': {
    name: 'Steel Cage Match',
    emoji: '🏗️',
    participants: 2,
    winConditions: ['pinfall', 'submission', 'escape'],
    rounds: { min: 5, max: 9 },
  },
  'hell-in-a-cell': {
    name: 'Hell in a Cell',
    emoji: '😈',
    participants: 2,
    winConditions: ['pinfall', 'submission'],
    rounds: { min: 6, max: 10 },
    weaponsAllowed: true,
    extreme: true,
  },
  ladder: {
    name: 'Ladder Match',
    emoji: '🪜',
    participants: [2, 6],
    winConditions: ['retrieve'],
    rounds: { min: 5, max: 9 },
  },
  'triple-threat': {
    name: 'Triple Threat Match',
    emoji: '🔺',
    participants: 3,
    winConditions: ['pinfall', 'submission'],
    rounds: { min: 5, max: 8 },
  },
  'fatal-four-way': {
    name: 'Fatal Four-Way',
    emoji: '💀',
    participants: 4,
    winConditions: ['pinfall', 'submission'],
    rounds: { min: 5, max: 9 },
  },
  'tag-team': {
    name: 'Tag Team Match',
    emoji: '🤝',
    participants: 4, // 2v2
    winConditions: ['pinfall', 'submission', 'count-out', 'dq'],
    rounds: { min: 4, max: 7 },
    isTagTeam: true,
  },
  'royal-rumble': {
    name: 'Royal Rumble',
    emoji: '👑',
    participants: [3, 30],
    winConditions: ['last-standing'],
    rounds: { min: 8, max: 15 },
  },
};

// Match flow beats — each round picks one
const MATCH_BEATS = {
  early: [
    'lock-up', 'feeling-out', 'headlock-takeover', 'shoulder-block',
    'chain-wrestling', 'staredown', 'cheap-shot', 'test-of-strength',
  ],
  mid: [
    'momentum-shift', 'signature-move', 'near-fall', 'counter',
    'top-rope-attempt', 'outside-brawl', 'submission-hold', 'comeback',
    'distraction', 'double-down', 'ref-bump', 'weapon-shot',
  ],
  late: [
    'finisher-attempt', 'finisher-counter', 'near-fall-kickout',
    'desperation-move', 'second-wind', 'super-finisher', 'roll-up',
  ],
  finish: [
    'clean-finish', 'dirty-finish', 'surprise-roll-up', 'submission-tap',
    'interference', 'double-count-out', 'ref-stoppage',
  ],
};

export class MatchEngine {
  constructor() {
    this.activeMatch = null;
    this.matchHistory = [];
  }

  /**
   * Load from saved state
   */
  loadFrom(saved) {
    if (!saved) return;
    if (saved.matchHistory) this.matchHistory = saved.matchHistory.slice(-50);
  }

  toJSON() {
    return { matchHistory: this.matchHistory.slice(-50) };
  }

  /**
   * Create a new match
   */
  createMatch(participants, matchType = 'singles', options = {}) {
    const type = MATCH_TYPES[matchType];
    if (!type) return { error: `Unknown match type: ${matchType}` };

    // Validate participants
    for (const p of participants) {
      if (!getCharacter(p)) return { error: `Unknown character: ${p}` };
    }

    const totalRounds = type.rounds.min + Math.floor(Math.random() * (type.rounds.max - type.rounds.min + 1));

    this.activeMatch = {
      id: `match-${Date.now()}`,
      type: matchType,
      typeName: type.name,
      typeEmoji: type.emoji,
      participants,
      stipulation: options.stipulation || null,
      forTitle: options.forTitle || null,
      totalRounds,
      currentRound: 0,
      momentum: {},  // charId -> number (-10 to 10)
      damage: {},    // charId -> number (0 to 100)
      eliminated: [],
      events: [],
      winner: null,
      winMethod: null,
      startedAt: Date.now(),
    };

    // Initialize momentum and damage
    for (const p of participants) {
      this.activeMatch.momentum[p] = 0;
      this.activeMatch.damage[p] = 0;
    }

    return this.activeMatch;
  }

  /**
   * Simulate the next round of the match
   * Returns a narrative beat + prompt for Ollama to expand on
   */
  simulateRound() {
    if (!this.activeMatch || this.activeMatch.winner) return null;

    const match = this.activeMatch;
    match.currentRound++;

    const phase = this._getPhase();
    const alive = match.participants.filter(p => !match.eliminated.includes(p));
    
    // Pick two active participants for this round's action
    const [actor, target] = this._pickCombatants(alive);
    
    // Simulate the round
    const beat = this._pickBeat(phase);
    const result = this._resolveBeat(beat, actor, target, phase);

    match.events.push({
      round: match.currentRound,
      phase,
      beat,
      actor,
      target,
      ...result,
    });

    // Check for finish
    if (phase === 'finish' || (phase === 'late' && match.currentRound >= match.totalRounds)) {
      this._resolveFinish(actor, target, result);
    }

    return {
      round: match.currentRound,
      totalRounds: match.totalRounds,
      phase,
      beat,
      actor,
      target,
      actorChar: getCharacter(actor),
      targetChar: getCharacter(target),
      ...result,
      momentum: { ...match.momentum },
      damage: { ...match.damage },
      isFinish: !!match.winner,
      winner: match.winner,
      winMethod: match.winMethod,
    };
  }

  /**
   * Simulate an entire match at once
   * Returns array of all round results
   */
  simulateFullMatch(participants, matchType = 'singles', options = {}) {
    const match = this.createMatch(participants, matchType, options);
    if (match.error) return match;

    const rounds = [];
    while (!this.activeMatch.winner) {
      const round = this.simulateRound();
      if (!round) break;
      rounds.push(round);
      
      // Safety valve
      if (rounds.length > 20) {
        this._forceFinish();
        rounds.push({
          round: this.activeMatch.currentRound,
          beat: 'forced-finish',
          narrative: 'The match ends decisively!',
          isFinish: true,
          winner: this.activeMatch.winner,
          winMethod: this.activeMatch.winMethod,
        });
        break;
      }
    }

    // Record in history
    this.matchHistory.push({
      id: this.activeMatch.id,
      type: matchType,
      participants,
      winner: this.activeMatch.winner,
      winMethod: this.activeMatch.winMethod,
      rounds: rounds.length,
      forTitle: options.forTitle || null,
      timestamp: Date.now(),
    });

    const result = {
      match: this.activeMatch,
      rounds,
    };

    this.activeMatch = null;
    return result;
  }

  /**
   * Build an Ollama prompt for a match round
   */
  buildRoundPrompt(roundResult) {
    const actor = roundResult.actorChar;
    const target = roundResult.targetChar;
    if (!actor || !target) return null;

    const phaseDesc = {
      early: 'The match is just getting started. The crowd is buzzing.',
      mid: 'The match is in full swing. The pace is picking up.',
      late: 'This match could end at any moment! The crowd is on their feet!',
      finish: 'THIS IS IT! The decisive moment!',
    };

    const beatNarratives = {
      'lock-up': `${actor.name} and ${target.name} lock up in the center of the ring.`,
      'feeling-out': `Both competitors are testing each other, looking for an opening.`,
      'momentum-shift': `${actor.name} has seized the momentum! ${target.name} is reeling!`,
      'signature-move': `${actor.name} hits a signature move on ${target.name}!`,
      'near-fall': `${actor.name} goes for the cover! 1... 2... ${target.name} kicks out!`,
      'counter': `${target.name} counters ${actor.name}'s attack with a devastating reversal!`,
      'finisher-attempt': `${actor.name} is setting up for the ${actor.finisher || 'finisher'}!`,
      'finisher-counter': `${target.name} COUNTERS the ${actor.finisher || 'finisher'}! What a reversal!`,
      'near-fall-kickout': `${actor.name} hits the ${actor.finisher || 'finisher'}! Cover! 1... 2... NO! ${target.name} kicks out at the last second!`,
      'comeback': `${actor.name} is mounting a comeback! The crowd is going WILD!`,
      'outside-brawl': `The action has spilled to the outside! Both men brawling near the announce table!`,
      'weapon-shot': `${actor.name} grabs a steel chair! CRACK! Right across ${target.name}'s back!`,
      'ref-bump': `The referee is down! Accidental collision! No one's counting!`,
      'double-down': `Both competitors are down! The referee starts the count!`,
      'clean-finish': `${actor.name} hits the ${actor.finisher || 'finisher'}! Cover! 1... 2... 3! It's over!`,
      'dirty-finish': `Low blow by ${actor.name} while the ref wasn't looking! Roll-up! 1-2-3! Stolen victory!`,
      'surprise-roll-up': `Small package by ${actor.name}! 1-2-3! OUT OF NOWHERE!`,
      'submission-tap': `${actor.name} locks in the hold! ${target.name} is fading... TAP! ${target.name} taps out!`,
      'interference': `Wait — someone is running down the ramp! INTERFERENCE!`,
    };

    const narrative = beatNarratives[roundResult.beat] || 
      `${actor.name} and ${target.name} exchange blows in a back-and-forth battle!`;

    return {
      narrative,
      commentaryPrompt: `${phaseDesc[roundResult.phase] || ''}\n\n${narrative}\n\nProvide 1-2 lines of exciting commentary for this moment. Be dramatic!`,
      characterPrompt: `You just ${roundResult.isFinish ? (roundResult.winner === roundResult.actor ? 'WON' : 'LOST') : 'experienced this'}: ${narrative}\n\nReact in character in 1-2 sentences.`,
    };
  }

  /**
   * Get match state for API
   */
  getState() {
    return {
      activeMatch: this.activeMatch,
      recentMatches: this.matchHistory.slice(-10),
      matchTypes: Object.entries(MATCH_TYPES).map(([id, t]) => ({
        id, name: t.name, emoji: t.emoji,
      })),
    };
  }

  // ------- Internal -------

  _getPhase() {
    const match = this.activeMatch;
    const pct = match.currentRound / match.totalRounds;
    if (pct <= 0.25) return 'early';
    if (pct <= 0.6) return 'mid';
    if (pct < 1.0) return 'late';
    return 'finish';
  }

  _pickCombatants(alive) {
    // Always randomize who's the actor to prevent first-mover advantage
    const shuffled = [...alive].sort(() => Math.random() - 0.5);
    return [shuffled[0], shuffled[1]];
  }

  _pickBeat(phase) {
    const beats = MATCH_BEATS[phase] || MATCH_BEATS.mid;
    // Filter out weapon shots if not allowed
    const type = MATCH_TYPES[this.activeMatch.type];
    const filtered = type?.weaponsAllowed ? beats : beats.filter(b => b !== 'weapon-shot');
    return filtered[Math.floor(Math.random() * filtered.length)];
  }

  _resolveBeat(beat, actor, target, phase) {
    const match = this.activeMatch;
    const momentumSwing = Math.floor(Math.random() * 3) + 1;

    // Actor gains momentum in most cases
    match.momentum[actor] = Math.min(10, (match.momentum[actor] || 0) + momentumSwing);
    match.momentum[target] = Math.max(-10, (match.momentum[target] || 0) - 1);

    // Damage accumulates
    const dmg = phase === 'early' ? Math.random() * 10 : phase === 'mid' ? Math.random() * 15 + 5 : Math.random() * 20 + 10;
    match.damage[target] = Math.min(100, (match.damage[target] || 0) + dmg);

    // Counter beats reverse momentum
    if (beat === 'counter' || beat === 'finisher-counter' || beat === 'comeback') {
      match.momentum[actor] = Math.max(-10, match.momentum[actor] - momentumSwing * 2);
      match.momentum[target] = Math.min(10, match.momentum[target] + momentumSwing * 2);
      match.damage[actor] = Math.min(100, (match.damage[actor] || 0) + dmg * 0.5);
    }

    return { momentumSwing, damageDealt: Math.round(dmg) };
  }

  _resolveFinish(actor, target, result) {
    const match = this.activeMatch;
    
    // Higher momentum + more damage on opponent = more likely to win
    const actorScore = (match.momentum[actor] || 0) + (match.damage[target] || 0) / 10;
    const targetScore = (match.momentum[target] || 0) + (match.damage[actor] || 0) / 10;

    // Slight randomness
    const actorFinal = actorScore + Math.random() * 5;
    const targetFinal = targetScore + Math.random() * 5;

    match.winner = actorFinal >= targetFinal ? actor : target;

    // Pick win method
    const type = MATCH_TYPES[match.type];
    const methods = type?.winConditions || ['pinfall'];
    match.winMethod = methods[Math.floor(Math.random() * methods.length)];
  }

  _forceFinish() {
    const match = this.activeMatch;
    const alive = match.participants.filter(p => !match.eliminated.includes(p));
    
    // Highest damage dealt wins
    let winner = alive[0];
    let bestScore = -Infinity;
    for (const p of alive) {
      const score = Object.entries(match.damage)
        .filter(([k]) => k !== p)
        .reduce((sum, [, v]) => sum + v, 0);
      if (score > bestScore) { bestScore = score; winner = p; }
    }

    match.winner = winner;
    match.winMethod = 'pinfall';
  }
}

export { MATCH_TYPES };
