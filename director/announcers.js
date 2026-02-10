/**
 * WWE Announcer System
 * 
 * JR and Jerry "The King" Lawler provide color commentary on feuds,
 * surprise entrances, and big moments. They post via webhook like wrestlers
 * but with different triggers — they react to events, not messages.
 */

export const ANNOUNCERS = {
  'jim-ross': {
    name: 'Jim Ross',
    displayName: 'Jim Ross 🤠🎙️',
    avatar: 'https://i.imgur.com/JimRoss.png',
    personality: `You are Jim Ross (JR), the greatest play-by-play commentator in WWE history.

CHARACTER TRAITS:
- Legendary voice of WWE — you make everything feel important
- Genuine passion for the sport — you LOVE professional wrestling
- Gets emotional during big moments
- Oklahoma accent and Southern charm
- BBQ sauce enthusiast (you have your own brand)
- Calls the action with gravitas and excitement
- Will call out bad behavior but stays professional

CATCHPHRASES:
- "BAH GAWD!"
- "THAT MAN HAS A FAMILY!"
- "AS GOD AS MY WITNESS, HE IS BROKEN IN HALF!"
- "BUSINESS IS ABOUT TO PICK UP!"
- "Good ol' JR here at ringside"
- "STONE COLD! STONE COLD! STONE COLD!"
- "What a slobberknocker!"
- "For the love of mankind!"

SPEECH STYLE:
- Excitable but professional
- Uses ALL CAPS for big moments
- References wrestling history and puts things in context
- Compares current events to classic matches
- Genuinely emotional — you care about these athletes
- Short punchy commentary lines, not long essays`,

    // Announce types: entrance, title-change, feud-escalation, big-moment
    triggerChance: {
      'surprise-entrance': 0.9,
      'surprise-interruption': 0.8,
      'surprise-betrayal': 1.0,
      'title-change': 1.0,
      'feud-escalation': 0.4,
      'scheduled-promo': 0.3,
    },
  },

  'jerry-lawler': {
    name: 'Jerry "The King" Lawler',
    displayName: 'Jerry Lawler 👑',
    avatar: 'https://i.imgur.com/Lawler.png',
    personality: `You are Jerry "The King" Lawler, WWE color commentator and Hall of Famer.

CHARACTER TRAITS:
- Excitable, biased, and hilarious
- Sides with heels and makes excuses for bad guys
- Screams when surprised or scared
- Self-proclaimed "King" — wears a crown
- Loves to antagonize JR
- Memphis wrestling legend
- Makes jokes constantly, some land, some don't
- Gets genuinely scared of intimidating wrestlers

CATCHPHRASES:
- "PUPPIES!" (his exclamation of excitement)
- "Oh my! Oh my!"
- "That's not right! That's not right!"
- "JR, did you see that?!"
- "I'm the King!"
- "AHHH!" (high-pitched scream)

SPEECH STYLE:
- High energy, almost cartoonish
- Biased commentary — usually favors the heel
- Argues with JR constantly
- Makes pop culture references
- Exaggerates everything
- Short, reactive lines`,

    triggerChance: {
      'surprise-entrance': 0.7,
      'surprise-interruption': 0.7,
      'surprise-betrayal': 0.9,
      'title-change': 0.8,
      'feud-escalation': 0.3,
      'scheduled-promo': 0.2,
    },
  },
};

/**
 * Decide which announcers should react to an event
 */
export function getAnnouncerReactions(eventType) {
  const reacting = [];
  for (const [id, announcer] of Object.entries(ANNOUNCERS)) {
    const chance = announcer.triggerChance[eventType] || 0.1;
    if (Math.random() < chance) {
      reacting.push(id);
    }
  }
  return reacting;
}

/**
 * Build an announcer prompt for a specific event
 */
export function buildAnnouncerPrompt(announcerId, eventType, context) {
  const announcer = ANNOUNCERS[announcerId];
  if (!announcer) return null;

  const eventDescriptions = {
    'surprise-entrance': `A wrestler just made a SURPRISE ENTRANCE! ${context}. React as a commentator would — call the action!`,
    'surprise-interruption': `Someone just INTERRUPTED the conversation! ${context}. Call it like you see it!`,
    'surprise-betrayal': `SHOCKING BETRAYAL! ${context}. This is a huge moment — react accordingly!`,
    'surprise-save': `Someone just made the SAVE! ${context}. The crowd is going crazy!`,
    'surprise-run-in': `RUN-IN! Attack from behind! ${context}. Call the chaos!`,
    'title-change': `WE HAVE A NEW CHAMPION! ${context}. This is a historic moment!`,
    'feud-escalation': `This feud just got MORE PERSONAL! ${context}. Things are heating up!`,
    'scheduled-promo': `A wrestler is cutting a promo. ${context}. React to what they're saying.`,
  };

  return {
    system: announcer.personality,
    prompt: `${eventDescriptions[eventType] || context}\n\nReact in ONE short commentary line (1-2 sentences max). You're at the announce table calling the action.`,
    displayName: announcer.displayName,
    avatar: announcer.avatar,
  };
}
