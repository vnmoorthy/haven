// Minimal test runner for Friendly Greeter (no external test framework).
const assert = require('assert');
const results = { passed: 0, failed: 0 };
function test(name, fn) {
  try { fn(); results.passed++; console.log('  ok   ' + name); }
  catch (e) { results.failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

const bot = require('../src/index.js');

console.log('Friendly Greeter test suite');
test('ping responds with pong', () => assert.strictEqual(bot.handleMessage({ content: '!ping' }), 'pong'));
test('help lists commands', () => assert.match(bot.handleMessage({ content: '!help' }), /!rules/));
test('rules link is https', () => assert.match(bot.handleMessage({ content: '!rules' }), /https:\/\//));
test('unknown commands are ignored', () => assert.strictEqual(bot.handleMessage({ content: '!constructor' }), null));
test('welcome truncates long names', () => assert.ok(bot.welcome({ displayName: 'x'.repeat(500) }).length < 140));
test('missing token throws instead of falling back', () => {
  const saved = process.env.BOT_TOKEN; delete process.env.BOT_TOKEN;
  assert.throws(() => bot.getToken(), /BOT_TOKEN/);
  if (saved) process.env.BOT_TOKEN = saved;
});

console.log(`\n# tests ${results.passed + results.failed}\n# pass ${results.passed}\n# fail ${results.failed}`);
process.exit(results.failed ? 1 : 0);
