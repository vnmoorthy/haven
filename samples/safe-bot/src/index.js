// Friendly Greeter — a minimal, least-privilege community bot.
// Token is read from the environment at runtime and never logged.
const { z } = require('zod');

const Config = z.object({
  prefix: z.string().min(1).max(3).default('!'),
  rulesUrl: z.string().url().startsWith('https://').default('https://example.org/rules'),
});

const config = Config.parse({});

const COMMANDS = {
  help: () => 'Commands: !help, !rules, !ping',
  rules: () => `Please read the community rules: ${config.rulesUrl}`,
  ping: () => 'pong',
};

function welcome(member) {
  const name = String(member.displayName || 'friend').slice(0, 64);
  return `Welcome to the community, ${name}! Type !help to get started.`;
}

function handleMessage(message) {
  const content = String(message.content || '');
  if (!content.startsWith(config.prefix)) return null;
  const cmd = content.slice(config.prefix.length).trim().split(/\s+/)[0].toLowerCase();
  const handler = Object.prototype.hasOwnProperty.call(COMMANDS, cmd) ? COMMANDS[cmd] : null;
  return handler ? handler() : null;
}

function getToken() {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN is not set');
  return token;
}

module.exports = { handleMessage, welcome, getToken, config };

if (require.main === module) {
  getToken();
  console.log('[greeter] ready');
}
