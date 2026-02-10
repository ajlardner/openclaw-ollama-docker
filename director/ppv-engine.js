/**
 * WWE Pay-Per-View Event System
 * 
 * Schedule PPV events with full match cards. Events auto-run at scheduled time
 * or can be triggered manually. Each match runs sequentially with drama pacing.
 * 
 * Features:
 * - Pre-built PPV templates (WrestleMania, SummerSlam, Royal Rumble, etc.)
 * - Custom match cards with title matches, stipulations
 * - Pre-show hype (promos posted before event starts)
 * - Event results summary
 */

import { getCharacter } from './characters.js';

const PPV_TEMPLATES = {
  wrestlemania: {
    name: 'WrestleMania',
    emoji: '🌟',
    tagline: 'The Showcase of the Immortals',
    matchCount: { min: 4, max: 7 },
    prestige: 10,
    theme: 'The grandest stage of them all. Every match matters. Legacies are defined tonight.',
  },
  summerslam: {
    name: 'SummerSlam',
    emoji: '☀️',
    tagline: 'The Biggest Party of the Summer',
    matchCount: { min: 4, max: 6 },
    prestige: 9,
    theme: 'Summer heat. Tempers flare. The feuds reach their boiling point.',
  },
  'royal-rumble': {
    name: 'Royal Rumble',
    emoji: '👑',
    tagline: 'Every Man for Himself',
    matchCount: { min: 3, max: 5 },
    prestige: 9,
    theme: 'The road to WrestleMania starts here. 30 men, one winner, a main event at WrestleMania.',
    specialMatch: 'royal-rumble',
  },
  survivor_series: {
    name: 'Survivor Series',
    emoji: '⚔️',
    tagline: 'The One Night of the Year Where Raw and SmackDown Collide',
    matchCount: { min: 3, max: 5 },
    prestige: 8,
    theme: 'Brand supremacy. Elimination matches. Only the survivors remain.',
  },
  'hell-in-a-cell-ppv': {
    name: 'Hell in a Cell',
    emoji: '😈',
    tagline: 'Satan\'s Structure',
    matchCount: { min: 3, max: 5 },
    prestige: 8,
    theme: 'The most demonic structure in WWE. No escape. No mercy.',
    defaultMatchType: 'hell-in-a-cell',
  },
  'money-in-the-bank': {
    name: 'Money in the Bank',
    emoji: '💰',
    tagline: 'Opportunity Hangs Above the Ring',
    matchCount: { min: 3, max: 5 },
    prestige: 8,
    theme: 'A ladder match for a guaranteed title shot. Cash in anytime, anywhere.',
    specialMatch: 'ladder',
  },
  'tables-ladders-chairs': {
    name: 'TLC: Tables, Ladders & Chairs',
    emoji: '🪜🪑',
    tagline: 'Oh My!',
    matchCount: { min: 3, max: 5 },
    prestige: 7,
    theme: 'Weapons are not just legal — they\'re encouraged.',
  },
  elimination_chamber: {
    name: 'Elimination Chamber',
    emoji: '🔒',
    tagline: 'No Way Out',
    matchCount: { min: 3, max: 5 },
    prestige: 8,
    theme: 'Six men. Four pods. One chance. The Chamber decides everything.',
  },
};

export class PPVEngine {
  constructor() {
    this.scheduledEvents = [];  // Upcoming PPVs
    this.completedEvents = [];  // Past PPVs
    this.activeEvent = null;    // Currently running
  }

  loadFrom(saved) {
    if (!saved) return;
    if (saved.scheduledEvents) this.scheduledEvents = saved.scheduledEvents;
    if (saved.completedEvents) this.completedEvents = saved.completedEvents.slice(-20);
  }

  toJSON() {
    return {
      scheduledEvents: this.scheduledEvents,
      completedEvents: this.completedEvents.slice(-20),
    };
  }

  /**
   * Schedule a new PPV event
   */
  scheduleEvent(templateId, options = {}) {
    const template = PPV_TEMPLATES[templateId];
    if (!template) return { error: `Unknown PPV template: ${templateId}` };

    const event = {
      id: `ppv-${Date.now()}`,
      templateId,
      name: options.name || template.name,
      emoji: template.emoji,
      tagline: template.tagline,
      theme: template.theme,
      prestige: template.prestige,
      scheduledAt: options.scheduledAt || null,  // null = manual trigger
      matchCard: options.matchCard || [],
      status: 'scheduled',
      createdAt: Date.now(),
    };

    this.scheduledEvents.push(event);
    return event;
  }

  /**
   * Add a match to a scheduled PPV's card
   */
  addMatch(eventId, match) {
    const event = this.scheduledEvents.find(e => e.id === eventId);
    if (!event) return { error: 'Event not found' };
    if (event.status !== 'scheduled') return { error: 'Event already started/completed' };

    const entry = {
      order: event.matchCard.length + 1,
      participants: match.participants,
      matchType: match.matchType || 'singles',
      forTitle: match.forTitle || null,
      stipulation: match.stipulation || null,
      isMainEvent: match.isMainEvent || false,
    };

    event.matchCard.push(entry);
    return entry;
  }

  /**
   * Auto-generate a match card based on active feuds and roster
   */
  autoBookCard(event, feuds, activeChars, championships) {
    const card = [];
    const booked = new Set();

    // Main event: highest intensity feud
    const sortedFeuds = [...feuds].sort((a, b) => b.intensity - a.intensity);
    
    for (const feud of sortedFeuds) {
      const [c1, c2] = feud.between;
      if (booked.has(c1) || booked.has(c2)) continue;
      if (!getCharacter(c1) || !getCharacter(c2)) continue;

      const matchType = feud.intensity >= 8 ? 'hell-in-a-cell' : 
                        feud.intensity >= 6 ? 'no-dq' : 'singles';

      // Check if either holds a title — make it a title match
      let forTitle = null;
      if (championships) {
        const state = championships.getState();
        for (const [titleId, data] of Object.entries(state)) {
          if (data.holder === c1 || data.holder === c2) {
            forTitle = titleId;
            break;
          }
        }
      }

      card.push({
        order: card.length + 1,
        participants: [c1, c2],
        matchType,
        forTitle,
        isMainEvent: card.length === 0,
      });

      booked.add(c1);
      booked.add(c2);
      if (card.length >= 5) break;
    }

    // Fill remaining spots with unbooked active characters
    const unbooked = activeChars.filter(c => !booked.has(c) && getCharacter(c));
    while (unbooked.length >= 2 && card.length < 6) {
      const c1 = unbooked.shift();
      const c2 = unbooked.shift();
      card.push({
        order: card.length + 1,
        participants: [c1, c2],
        matchType: 'singles',
        forTitle: null,
        isMainEvent: false,
      });
      booked.add(c1);
      booked.add(c2);
    }

    return card;
  }

  /**
   * Start running a PPV event (returns the event for the caller to process matches)
   */
  startEvent(eventId) {
    const idx = this.scheduledEvents.findIndex(e => e.id === eventId);
    if (idx === -1) return { error: 'Event not found' };

    const event = this.scheduledEvents[idx];
    if (event.matchCard.length === 0) return { error: 'No matches on the card' };

    event.status = 'in-progress';
    event.startedAt = Date.now();
    event.results = [];
    this.activeEvent = event;

    // Remove from scheduled
    this.scheduledEvents.splice(idx, 1);

    return event;
  }

  /**
   * Record a match result during a live PPV
   */
  recordMatchResult(matchOrder, result) {
    if (!this.activeEvent) return;
    this.activeEvent.results.push({
      order: matchOrder,
      ...result,
      timestamp: Date.now(),
    });
  }

  /**
   * Complete the active PPV
   */
  completeEvent() {
    if (!this.activeEvent) return null;
    
    this.activeEvent.status = 'completed';
    this.activeEvent.completedAt = Date.now();
    
    const completed = { ...this.activeEvent };
    this.completedEvents.push(completed);
    this.activeEvent = null;

    return completed;
  }

  /**
   * Build pre-show hype messages
   */
  buildHypeMessages(event) {
    const messages = [];
    const template = PPV_TEMPLATES[event.templateId] || {};

    messages.push(
      `${event.emoji || '🎤'} **${event.name.toUpperCase()}** ${event.emoji || '🎤'}\n` +
      `*"${event.tagline || 'This is gonna be good'}"*\n\n` +
      `${event.theme || 'The biggest event of the year!'}\n\n` +
      `**TONIGHT'S CARD:**`
    );

    for (const match of event.matchCard) {
      const names = match.participants.map(p => getCharacter(p)?.displayName || p);
      const titleStr = match.forTitle ? ` *(${match.forTitle} on the line!)*` : '';
      const mainStr = match.isMainEvent ? ' 🌟 **MAIN EVENT**' : '';
      const typeStr = match.matchType !== 'singles' ? ` [${match.matchType.toUpperCase()}]` : '';
      messages.push(`${match.order}. ${names.join(' vs ')}${typeStr}${titleStr}${mainStr}`);
    }

    return messages;
  }

  /**
   * Build results summary
   */
  buildResultsSummary(event) {
    if (!event.results || event.results.length === 0) return '';

    let summary = `${event.emoji} **${event.name.toUpperCase()} — RESULTS** ${event.emoji}\n\n`;
    
    for (const result of event.results) {
      const match = event.matchCard.find(m => m.order === result.order);
      const winnerName = getCharacter(result.winner)?.displayName || result.winner;
      const participants = match?.participants.map(p => getCharacter(p)?.displayName || p).join(' vs ') || 'Unknown';
      const mainStr = match?.isMainEvent ? ' 🌟' : '';
      summary += `**Match ${result.order}${mainStr}:** ${participants}\n`;
      summary += `  🏆 Winner: ${winnerName} (${result.winMethod})\n`;
      if (result.titleChange) summary += `  👑 NEW CHAMPION!\n`;
      summary += '\n';
    }

    return summary;
  }

  /**
   * Get state for API/dashboard
   */
  getState() {
    return {
      scheduled: this.scheduledEvents,
      active: this.activeEvent,
      completed: this.completedEvents.slice(-10),
      templates: Object.entries(PPV_TEMPLATES).map(([id, t]) => ({
        id, name: t.name, emoji: t.emoji, tagline: t.tagline, prestige: t.prestige,
      })),
    };
  }
}

export { PPV_TEMPLATES };
