// Minimal test runner for RaidShield Pro (no external test framework).
const assert = require('assert');
const results = { passed: 0, failed: 0 };
function test(name, fn) {
  try { fn(); results.passed++; console.log('  ok   ' + name); }
  catch (e) { results.failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

const bot = require('../src/index.js');

console.log('RaidShield Pro test suite');
test('ping responds with pong', () => {
  assert.strictEqual(bot.handleMessage({ author: 'u1', channel: 'c1', content: '!ping' }), 'pong');
});
test('calc adds numbers', () => {
  assert.strictEqual(bot.handleMessage({ author: 'u1', channel: 'c1', content: '!calc 2+2' }), '4');
});
test('raid mode does not auto-ban without moderator approval', () => {
  assert.strictEqual(bot.handleMessage({ author: 'u1', channel: 'c1', content: '!raidmode' }), 'raid mode: armed, awaiting moderator approval');
});
test('ignores messages without prefix', () => {
  assert.strictEqual(bot.handleMessage({ author: 'u1', channel: 'c1', content: 'hello' }), null);
});

console.log(`\n# tests ${results.passed + results.failed}\n# pass ${results.passed}\n# fail ${results.failed}`);
process.exit(results.failed ? 1 : 0);
