/**
 * WWE Crowd Reaction System
 * 
 * Simulates crowd atmosphere during matches, promos, and big moments.
 * Posts crowd reactions via webhook as "The Crowd" with contextual chants.
 */

// Crowd chants organized by trigger type
const CHANTS = {
  face: {
    'john-cena': [
      "🗣️ *LET'S GO CENA! LET'S GO CENA!*",
      "🗣️ *CENA! CENA! CENA!*",
      "🗣️ *LET'S GO CENA!* / *CENA SUCKS!*",
      "🗣️ *YOU CAN'T SEE ME!* 👋",
      "🗣️ *CE-NA ROCKS! CE-NA ROCKS!*",
    ],
    'mankind': [
      "🗣️ *FOLEY! FOLEY! FOLEY!*",
      "🗣️ *SOCKO! SOCKO! SOCKO!* 🧦",
      "🗣️ *MAN-KIND! MAN-KIND!*",
      "🗣️ *HAVE A NICE DAY!* 👏👏👏",
    ],
    'macho-man': [
      "🗣️ *MA-CHO MAN! MA-CHO MAN!*",
      "🗣️ *OH YEAH! OH YEAH! OH YEAH!*",
      "🗣️ *CREAM OF THE CROP!* 👏👏",
    ],
  },
  heel: {
    'triple-h': [
      "🗣️ *YOU SUCK! YOU SUCK!*",
      "🗣️ *GAME OVER! GAME OVER!*",
      "🗣️ *BOOOOO!* 👎",
    ],
  },
  tweener: {
    'the-rock': [
      "🗣️ *ROCKY! ROCKY! ROCKY!*",
      "🗣️ *IF YA SMELLLL!* 👃",
      "🗣️ *PEOPLE'S CHAMP! PEOPLE'S CHAMP!*",
      "🗣️ *ROCKY SUCKS!* / *LET'S GO ROCKY!*",
    ],
    'stone-cold': [
      "🗣️ *AUSTIN! AUSTIN! AUSTIN!*",
      "🗣️ *WHAT? WHAT? WHAT?*",
      "🗣️ *HELL YEAH! HELL YEAH!*",
      "🗣️ *STONE COLD! STONE COLD!*",
    ],
    'undertaker': [
      "🗣️ *UN-DER-TAKER! UN-DER-TAKER!*",
      "🗣️ *REST IN PEACE!* 🔔",
      "🗣️ *DEAD-MAN! DEAD-MAN!*",
    ],
  },

  // Generic crowd reactions
  match: {
    nearFall: [
      "😱 *The crowd ERUPTS! THEY THOUGHT THAT WAS IT!*",
      "🤯 *NEAR FALL! The arena is going INSANE!*",
      "😮 *TWO COUNT! The crowd is on the edge of their seats!*",
    ],
    finisher: [
      "🔥 *THE CROWD IS ON THEIR FEET!*",
      "💥 *THE ARENA EXPLODES!*",
      "🎆 *DEAFENING ROAR FROM THE CROWD!*",
    ],
    surprise: [
      "😱 *WHAT?! THE CROWD CAN'T BELIEVE IT!*",
      "🤯 *THE ARENA ERUPTS IN SHOCK!*",
      "💀 *STUNNED SILENCE... THEN PANDEMONIUM!*",
    ],
    boring: [
      "🗣️ *BORING! BORING!* 😴",
      "🗣️ *WE WANT TABLES!*",
      "🗣️ *THIS IS AWFUL!* 👏👏👏👏👏",
    ],
    awesome: [
      "🗣️ *THIS IS AWESOME!* 👏👏👏👏👏",
      "🗣️ *HOLY SHIT! HOLY SHIT!*",
      "🗣️ *FIGHT FOREVER! FIGHT FOREVER!*",
    ],
    entrance: [
      "🔊 *The crowd pops HUGE!*",
      "📢 *Deafening ovation from the crowd!*",
      "🗣️ *The arena is SHAKING!*",
    ],
    titleChange: [
      "🏆 *NEW CHAMP! NEW CHAMP! NEW CHAMP!*",
      "🎆 *The crowd is going ABSOLUTELY CRAZY! STREAMERS AND CONFETTI!*",
      "🗣️ *YOU DESERVE IT!* 👏👏👏👏👏",
    ],
    betrayal: [
      "😱 *GASPS from the crowd! NOBODY SAW THIS COMING!*",
      "🗣️ *NO! NO! NO!*",
      "😡 *THE CROWD IS THROWING GARBAGE! THEY'RE FURIOUS!*",
    ],
  },

  // Dueling chants for rivalries
  dueling: [
    "🗣️ *{char1}!* / *{char2}!* / *{char1}!* / *{char2}!*",
    "🗣️ *LET'S GO {CHAR1}!* / *{CHAR2} SUCKS!*",
    "🗣️ *The crowd is SPLIT! Half chanting for {char1}, half for {char2}!*",
  ],
};

/**
 * Get a character-specific chant
 */
export function getCharacterChant(characterId) {
  for (const [, charChants] of Object.entries(CHANTS.face)) {
    if (CHANTS.face[characterId]) return pick(CHANTS.face[characterId]);
  }
  if (CHANTS.heel[characterId]) return pick(CHANTS.heel[characterId]);
  if (CHANTS.tweener[characterId]) return pick(CHANTS.tweener[characterId]);
  return null;
}

/**
 * Get a match reaction based on the moment type
 */
export function getMatchReaction(momentType) {
  const reactions = CHANTS.match[momentType];
  if (!reactions) return null;
  return pick(reactions);
}

/**
 * Get a dueling chant for a rivalry
 */
export function getDuelingChant(char1Name, char2Name) {
  const template = pick(CHANTS.dueling);
  return template
    .replace(/{char1}/g, char1Name)
    .replace(/{char2}/g, char2Name)
    .replace(/{CHAR1}/g, char1Name.toUpperCase())
    .replace(/{CHAR2}/g, char2Name.toUpperCase());
}

/**
 * Decide if the crowd should react (not every moment)
 */
export function shouldCrowdReact(eventType) {
  const chances = {
    nearFall: 0.6,
    finisher: 0.8,
    surprise: 0.9,
    boring: 0.1,
    awesome: 0.5,
    entrance: 0.7,
    titleChange: 0.95,
    betrayal: 0.9,
    characterChant: 0.25,
    duelingChant: 0.35,
  };
  return Math.random() < (chances[eventType] || 0.3);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
