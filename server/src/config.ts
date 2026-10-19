import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..');
// Keys live in the repo-root .env (npm workspaces run the server from server/, so load it explicitly).
dotenv.config({ path: resolve(ROOT, '.env'), quiet: true } as any);
dotenv.config({ path: resolve(ROOT, 'server/.env'), quiet: true } as any);

const env = (k: string, d = '') => (process.env[k] ?? d).trim();
const bool = (k: string, d = false) => { const v = env(k); return v ? ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()) : d; };

export const config = {
  port: Number(env('PORT', '8787')),
  publicUrl: env('HAVEN_PUBLIC_URL', `http://localhost:${env('PORT', '8787')}`),
  dbPath: resolve(ROOT, env('HAVEN_DB', 'data/haven.db')),
  dataDir: resolve(ROOT, 'data'),
  simAutostart: bool('HAVEN_SIM_AUTOSTART', true),
  // Flatkey — unified model gateway (OpenAI-compatible)
  flatkey: {
    apiKey: env('FLATKEY_API_KEY'),
    baseUrl: env('FLATKEY_BASE_URL', 'https://router.flatkey.ai/v1'),
    models: {
      fast: env('FLATKEY_MODEL_FAST', 'gemini-3.1-flash-lite'),
      reasoning: env('FLATKEY_MODEL_REASONING', 'claude-haiku-4-5'),
      coding: env('FLATKEY_MODEL_CODING', 'claude-haiku-4-5'),
      vision: env('FLATKEY_MODEL_VISION', 'gemini-3.1-flash-lite'),
    },
    fallbacks: env('FLATKEY_FALLBACK_MODELS', 'deepseek-v4-flash,gemini-3.1-flash-lite').split(',').map((s) => s.trim()).filter(Boolean),
  },
  anthropicKey: env('ANTHROPIC_API_KEY'),
  anthropicModel: env('ANTHROPIC_MODEL', 'claude-haiku-4-5'),
  openaiKey: env('OPENAI_API_KEY'),
  openaiBaseUrl: env('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
  openaiModel: env('OPENAI_MODEL', 'gpt-4o-mini'),
  localClaude: bool('HAVEN_LOCAL_CLAUDE', false),
  llmBudgetUsd: Number(env('HAVEN_LLM_BUDGET_USD', '5')),
  band: { apiKey: env('BAND_USER_KEY') || env('BAND_API_KEY'), baseUrl: env('BAND_REST_URL', 'https://app.band.ai/api/v1'), workspace: env('BAND_ROOM_TITLE', 'Haven HQ — AI workforce') },
  rocketride: { apiKey: env('ROCKETRIDE_APIKEY') || env('ROCKETRIDE_API_KEY') || env('ROCKETRIDE_AUTH'), baseUrl: env('ROCKETRIDE_URI', 'https://api.rocketride.ai') },
  n8n: { url: env('N8N_URL'), apiKey: env('N8N_API_KEY') },
  masky: { apiKey: env('MASKY_API_KEY'), baseUrl: env('MASKY_BASE_URL'), maskordWebhook: env('MASKORD_WEBHOOK_URL') },
  promptql: { apiKey: env('PROMPTQL_API_KEY'), baseUrl: env('PROMPTQL_BASE_URL'), projectId: env('PROMPTQL_PROJECT_ID') },
  paritok: { apiKey: env('PARITOK_API_KEY'), baseUrl: env('PARITOK_BASE_URL') },
  finch: { apiKey: env('FINCH_API_KEY'), baseUrl: env('FINCH_BASE_URL') },
  kylon: { apiKey: env('KYLON_API_KEY'), baseUrl: env('KYLON_BASE_URL') },
  celesto: { apiKey: env('CELESTO_API_KEY'), baseUrl: env('CELESTO_BASE_URL') },
  adal: { bin: env('ADAL_BIN', 'adal') },
  tenki: { apiKey: env('TENKI_API_KEY'), baseUrl: env('TENKI_BASE_URL') },
  prelint: { apiKey: env('PRELINT_API_KEY'), baseUrl: env('PRELINT_BASE_URL') },
  snyk: { token: env('SNYK_TOKEN'), bin: env('SNYK_BIN', 'snyk') },
  slackWebhook: env('SLACK_WEBHOOK_URL'),
};
