/**
 * Match Engine Tests
 * Run: node --experimental-vm-modules director/test-match-engine.js
 */

import { MatchEngine } from './match-engine.js';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

// ----- Test: Basic match creation -----
console.log('\n🤼 Match Creation');
{
  const engine = new MatchEngine();
  const match = engine.createMatch(['john-cena', 'the-rock']);
  assert(match.id.startsWith('match-'), 'Match has valid ID');
  assert(match.participants.length === 2, 'Has 2 participants');
  assert(match.type === 'singles', 'Default type is singles');
  assert(match.winner === null, 'No winner yet');
  assert(match.momentum['john-cena'] === 0, 'Initial momentum is 0');
  assert(match.damage['john-cena'] === 0, 'Initial damage is 0');
  assert(match.totalRounds >= 4 && match.totalRounds <= 7, `Rounds in range: ${match.totalRounds}`);
}

// ----- Test: Unknown character -----
console.log('\n🚫 Invalid Characters');
{
  const engine = new MatchEngine();
  const match = engine.createMatch(['john-cena', 'hulk-hogan']);
  assert(match.error !== undefined, 'Returns error for unknown character');
}

// ----- Test: Unknown match type -----
console.log('\n🚫 Invalid Match Type');
{
  const engine = new MatchEngine();
  const match = engine.createMatch(['john-cena', 'the-rock'], 'pillow-fight');
  assert(match.error !== undefined, 'Returns error for unknown match type');
}

// ----- Test: Full match simulation -----
console.log('\n🏆 Full Match Simulation');
{
  const engine = new MatchEngine();
  const result = engine.simulateFullMatch(['john-cena', 'the-rock']);
  assert(!result.error, 'No errors');
  assert(result.match.winner !== null, `Has a winner: ${result.match.winner}`);
  assert(['john-cena', 'the-rock'].includes(result.match.winner), 'Winner is a participant');
  assert(result.match.winMethod !== null, `Has win method: ${result.match.winMethod}`);
  assert(result.rounds.length >= 4, `At least 4 rounds: ${result.rounds.length}`);
  assert(result.rounds.length <= 21, `Not too many rounds: ${result.rounds.length}`);
  
  // Check round progression
  const phases = result.rounds.map(r => r.phase);
  assert(phases[0] === 'early', 'First round is early phase');
  assert(phases[phases.length - 1] === 'finish' || phases[phases.length - 1] === 'late', 'Last round is finish/late phase');
}

// ----- Test: All match types work -----
console.log('\n🎯 All Match Types');
for (const type of ['singles', 'no-dq', 'steel-cage', 'hell-in-a-cell', 'ladder', 'triple-threat']) {
  const engine = new MatchEngine();
  const participants = type === 'triple-threat' 
    ? ['john-cena', 'the-rock', 'stone-cold']
    : ['john-cena', 'the-rock'];
  const result = engine.simulateFullMatch(participants, type);
  assert(!result.error && result.match.winner, `${type}: produces a winner`);
}

// ----- Test: Match history tracking -----
console.log('\n📊 History Tracking');
{
  const engine = new MatchEngine();
  engine.simulateFullMatch(['john-cena', 'the-rock']);
  engine.simulateFullMatch(['stone-cold', 'triple-h']);
  assert(engine.matchHistory.length === 2, 'Two matches in history');
  assert(engine.matchHistory[0].participants.includes('john-cena'), 'First match has correct participants');
}

// ----- Test: Serialization -----
console.log('\n💾 Serialization');
{
  const engine = new MatchEngine();
  engine.simulateFullMatch(['john-cena', 'the-rock']);
  const json = engine.toJSON();
  assert(json.matchHistory.length === 1, 'JSON has history');
  
  const engine2 = new MatchEngine();
  engine2.loadFrom(json);
  assert(engine2.matchHistory.length === 1, 'Loaded history correctly');
}

// ----- Test: Round-by-round simulation -----
console.log('\n🔄 Round-by-Round');
{
  const engine = new MatchEngine();
  engine.createMatch(['john-cena', 'the-rock']);
  
  let roundCount = 0;
  let lastRound = null;
  while (true) {
    const round = engine.simulateRound();
    if (!round) break;
    roundCount++;
    lastRound = round;
    if (round.isFinish) break;
    if (roundCount > 25) break; // safety
  }
  
  assert(roundCount > 0, `Produced ${roundCount} rounds`);
  assert(lastRound?.isFinish === true, 'Last round is a finish');
  assert(lastRound?.winner !== null, 'Final round has winner');
}

// ----- Test: Momentum and damage accumulate -----
console.log('\n📈 Momentum & Damage');
{
  const engine = new MatchEngine();
  const result = engine.simulateFullMatch(['john-cena', 'the-rock']);
  const finalDamage = result.match.damage;
  assert(finalDamage['john-cena'] > 0 || finalDamage['the-rock'] > 0, 'Damage accumulated');
  
  // At least one person took real damage
  const maxDamage = Math.max(finalDamage['john-cena'], finalDamage['the-rock']);
  assert(maxDamage > 10, `Significant damage dealt: ${maxDamage.toFixed(1)}`);
}

// ----- Test: Build round prompt -----
console.log('\n📝 Prompt Building');
{
  const engine = new MatchEngine();
  engine.createMatch(['john-cena', 'the-rock']);
  const round = engine.simulateRound();
  const prompt = engine.buildRoundPrompt(round);
  assert(prompt !== null, 'Prompt is not null');
  assert(prompt.narrative.length > 0, 'Has narrative text');
  assert(prompt.commentaryPrompt.length > 0, 'Has commentary prompt');
  assert(prompt.characterPrompt.length > 0, 'Has character prompt');
}

// ----- Test: Match fairness (statistical) -----
console.log('\n⚖️ Fairness Check (100 matches)');
{
  const engine = new MatchEngine();
  let cenaWins = 0;
  for (let i = 0; i < 100; i++) {
    const result = engine.simulateFullMatch(['john-cena', 'the-rock']);
    if (result.match.winner === 'john-cena') cenaWins++;
  }
  // Should be roughly 50/50, allow 25-75 range
  assert(cenaWins >= 20 && cenaWins <= 80, `Cena won ${cenaWins}/100 (fair range: 20-80)`);
}

// ----- Results -----
console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(40)}`);
process.exit(failed > 0 ? 1 : 0);
