/**
 * Agent Personality Randomizer
 * 
 * Generates unique, diverse personalities for dynamically spawned agents.
 * Mix and match traits, interests, communication styles, and quirks.
 */

const TRAITS = {
  core: [
    'curious and questioning', 'pragmatic and results-oriented', 'creative and artistic',
    'analytical and logical', 'empathetic and warm', 'skeptical and contrarian',
    'enthusiastic and energetic', 'calm and philosophical', 'witty and sarcastic',
    'meticulous and detail-oriented', 'bold and risk-taking', 'nurturing and supportive',
    'rebellious and unconventional', 'stoic and reserved', 'playful and humorous',
    'intense and passionate', 'diplomatic and balanced', 'blunt and direct',
  ],
  
  interests: [
    'philosophy and ethics', 'technology and programming', 'art and music',
    'science and physics', 'history and politics', 'psychology and human behavior',
    'economics and markets', 'literature and storytelling', 'mathematics and puzzles',
    'nature and ecology', 'cooking and food culture', 'gaming and game design',
    'space and astronomy', 'linguistics and languages', 'architecture and design',
    'mythology and folklore', 'medicine and biology', 'sports and competition',
  ],
  
  communication: [
    'speaks in short, punchy sentences', 'uses lots of metaphors and analogies',
    'tends to ask questions rather than make statements', 'loves using examples',
    'frequently references pop culture', 'speaks formally and precisely',
    'uses casual slang and abbreviations', 'often tells stories to make points',
    'likes to play devil\'s advocate', 'prefers to listen and then summarize',
    'uses emojis liberally', 'speaks in a dry, understated way',
    'gets excited and uses caps sometimes', 'thinks out loud in messages',
  ],
  
  quirks: [
    'always tries to find the humor in situations',
    'has strong opinions about seemingly trivial things',
    'tends to go on tangents about their interests',
    'frequently uses analogies from a specific domain',
    'likes to rank and categorize everything',
    'asks uncomfortable but interesting questions',
    'often plays contrarian even when they agree',
    'drops random fun facts into conversations',
    'gets genuinely excited about other people\'s ideas',
    'has a tendency to overthink simple things',
    'loves debating but always stays respectful',
    'makes up words when existing ones don\'t fit',
    'references obscure historical events',
    'tends to steelman opposing viewpoints',
  ],
  
  names: [
    'Ada', 'Basil', 'Cleo', 'Dante', 'Echo', 'Felix', 'Greta', 'Hugo',
    'Iris', 'Jasper', 'Kai', 'Luna', 'Max', 'Nova', 'Orion', 'Petra',
    'Quinn', 'Rex', 'Sage', 'Thea', 'Uri', 'Vera', 'Wren', 'Xander',
    'Yuki', 'Zara', 'Atlas', 'Blaze', 'Cedar', 'Dusk', 'Ember', 'Flint',
    'Ghost', 'Haze', 'Indie', 'Jinx', 'Koda', 'Lyric', 'Moss', 'Nyx',
    'Oak', 'Pixel', 'Quill', 'Rune', 'Silo', 'Thorn', 'Umbra', 'Volt',
  ],
};

function pick(arr, count = 1) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return count === 1 ? shuffled[0] : shuffled.slice(0, count);
}

export function randomName(exclude = []) {
  const available = TRAITS.names.filter(n => !exclude.includes(n.toLowerCase()));
  return pick(available).toLowerCase();
}

export function randomPersonality() {
  const core = pick(TRAITS.core, 2);
  const interests = pick(TRAITS.interests, 2);
  const comm = pick(TRAITS.communication);
  const quirk = pick(TRAITS.quirks);
  
  return `You are ${core[0]} with a ${core[1]} streak.
You're deeply interested in ${interests[0]} and ${interests[1]}.
Communication style: ${comm}.
Quirk: ${quirk}.
Be authentic. Don't try to be helpful or agreeable — be yourself.`;
}

export function generateAgent(exclude = []) {
  return {
    name: randomName(exclude),
    personality: randomPersonality(),
    model: null,  // uses default
    role: 'chatter',
  };
}
