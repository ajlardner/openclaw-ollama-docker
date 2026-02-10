/**
 * WWE Championship System
 * 
 * Tracks title holders, defenses, and vacancy.
 * Championships add stakes to feuds — "I want YOUR title" hits different.
 */

const CHAMPIONSHIPS = {
  'wwe-championship': {
    name: 'WWE Championship',
    displayName: '🏆 WWE Championship',
    prestige: 10,
    description: 'The most prestigious title in sports entertainment',
  },
  'intercontinental': {
    name: 'Intercontinental Championship',
    displayName: '🥈 Intercontinental Championship',
    prestige: 7,
    description: 'The workhorse title',
  },
  'tag-team': {
    name: 'Tag Team Championship',
    displayName: '🤝 Tag Team Championship',
    prestige: 6,
    description: 'Requires a tag team partner',
    isTagTeam: true,
  },
  'hardcore': {
    name: 'Hardcore Championship',
    displayName: '🔨 Hardcore Championship',
    prestige: 4,
    description: '24/7 rules — can be won anytime, anywhere',
    is247: true,
  },
};

export class ChampionshipTracker {
  constructor() {
    // titleId -> { holder, wonAt, defenses, history[] }
    this.titles = {};
    for (const id of Object.keys(CHAMPIONSHIPS)) {
      this.titles[id] = { holder: null, wonAt: null, defenses: 0, history: [] };
    }
  }

  /**
   * Load state from saved data
   */
  loadFrom(saved) {
    if (!saved) return;
    for (const [id, data] of Object.entries(saved)) {
      if (this.titles[id]) {
        Object.assign(this.titles[id], data);
      }
    }
  }

  /**
   * Serialize for persistence
   */
  toJSON() {
    return this.titles;
  }

  /**
   * Award a title to a character
   */
  awardTitle(titleId, characterId, method = 'pinfall') {
    const title = this.titles[titleId];
    if (!title) return null;
    const belt = CHAMPIONSHIPS[titleId];

    const previousHolder = title.holder;
    
    if (previousHolder) {
      title.history.push({
        holder: previousHolder,
        wonAt: title.wonAt,
        lostAt: Date.now(),
        defenses: title.defenses,
      });
    }

    title.holder = characterId;
    title.wonAt = Date.now();
    title.defenses = 0;

    // Keep history manageable
    if (title.history.length > 20) title.history = title.history.slice(-20);

    return {
      titleId,
      titleName: belt.displayName,
      newChampion: characterId,
      previousChampion: previousHolder,
      method,
    };
  }

  /**
   * Record a successful title defense
   */
  recordDefense(titleId) {
    const title = this.titles[titleId];
    if (!title || !title.holder) return;
    title.defenses++;
  }

  /**
   * Vacate a title
   */
  vacateTitle(titleId) {
    const title = this.titles[titleId];
    if (!title) return;
    if (title.holder) {
      title.history.push({
        holder: title.holder,
        wonAt: title.wonAt,
        lostAt: Date.now(),
        defenses: title.defenses,
        vacated: true,
      });
    }
    title.holder = null;
    title.wonAt = null;
    title.defenses = 0;
  }

  /**
   * Get current champion for a title
   */
  getChampion(titleId) {
    return this.titles[titleId]?.holder || null;
  }

  /**
   * Get all titles held by a character
   */
  getTitlesForCharacter(characterId) {
    const held = [];
    for (const [id, data] of Object.entries(this.titles)) {
      if (data.holder === characterId) {
        held.push({ titleId: id, ...CHAMPIONSHIPS[id], ...data });
      }
    }
    return held;
  }

  /**
   * Get full championship state for API/dashboard
   */
  getState() {
    const result = {};
    for (const [id, data] of Object.entries(this.titles)) {
      result[id] = {
        ...CHAMPIONSHIPS[id],
        holder: data.holder,
        wonAt: data.wonAt,
        defenses: data.defenses,
        historyCount: data.history.length,
      };
    }
    return result;
  }

  /**
   * Generate title-related storyline context
   */
  getTitleContext(charId, opponentId) {
    const charTitles = this.getTitlesForCharacter(charId);
    const oppTitles = this.getTitlesForCharacter(opponentId);

    if (charTitles.length > 0) {
      const belt = charTitles[0];
      return `You are the current ${belt.displayName} champion with ${belt.defenses} successful defense${belt.defenses !== 1 ? 's' : ''}. Defend your title with pride.`;
    }
    if (oppTitles.length > 0) {
      const belt = oppTitles[0];
      return `Your opponent holds the ${belt.displayName}. You WANT that title. Make it clear you're coming for their gold.`;
    }
    return '';
  }
}

export { CHAMPIONSHIPS };
