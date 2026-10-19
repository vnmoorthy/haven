import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });
export const sqlite = new DatabaseSync(config.dbPath);
sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');

// Column definitions: name -> 'json' | 'text' | 'num'. camelCase keys are stored as snake_case columns.
const TABLES: Record<string, Record<string, 'json' | 'text' | 'num'>> = {
  communities: { id: 'text', name: 'text', platform: 'text', members: 'num', plan: 'text', mrr: 'num', createdAt: 'num', color: 'text', icon: 'text' },
  channels: { id: 'text', communityId: 'text', name: 'text', topic: 'text' },
  members: { id: 'text', communityId: 'text', handle: 'text', displayName: 'text', avatarSeed: 'text', trustScore: 'num', joinedAt: 'num', status: 'text', role: 'text' },
  messages: { id: 'text', channelId: 'text', memberId: 'text', authorKind: 'text', agentId: 'text', content: 'text', createdAt: 'num', status: 'text', risk: 'num', labels: 'json', incidentId: 'text', replyTo: 'text' },
  incidents: { id: 'text', kind: 'text', severity: 'text', status: 'text', title: 'text', summary: 'text', messageId: 'text', memberId: 'text', channelId: 'text', communityId: 'text', assignedTo: 'text', verdict: 'json', evidence: 'json', recommendedAction: 'text', actionTaken: 'text', createdAt: 'num', updatedAt: 'num', resolvedAt: 'num', timeToActionMs: 'num', risk: 'num' },
  band_messages: { id: 'text', from: 'text', to: 'text', kind: 'text', subject: 'text', body: 'text', payload: 'json', threadId: 'text', incidentId: 'text', createdAt: 'num', remote: 'text' },
  llm_calls: { id: 'text', agentId: 'text', model: 'text', provider: 'text', purpose: 'text', promptTokens: 'num', completionTokens: 'num', costUsd: 'num', latencyMs: 'num', fallback: 'num', createdAt: 'num', ok: 'num' },
  pipeline_runs: { id: 'text', pipelineId: 'text', status: 'text', input: 'json', output: 'json', stages: 'json', startedAt: 'num', finishedAt: 'num', incidentId: 'text', engine: 'text' },
  automation_runs: { id: 'text', workflowId: 'text', trigger: 'text', status: 'text', steps: 'json', mode: 'text', startedAt: 'num', finishedAt: 'num', payload: 'json' },
  audits: { id: 'text', target: 'text', status: 'text', grade: 'text', score: 'num', steps: 'json', snyk: 'json', tenki: 'json', prelint: 'json', summary: 'text', createdAt: 'num', finishedAt: 'num' },
  compressions: { id: 'text', agentId: 'text', beforeTokens: 'num', afterTokens: 'num', method: 'text', summary: 'text', createdAt: 'num' },
  wiki: { id: 'text', title: 'text', body: 'text', category: 'text', updatedBy: 'text', updatedAt: 'num' },
  kv: { id: 'text', value: 'json' },
};

const snake = (s: string) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const quote = (s: string) => `"${s}"`;

for (const [table, cols] of Object.entries(TABLES)) {
  const defs = Object.entries(cols).map(([k, t]) => `${quote(snake(k))} ${t === 'num' ? 'REAL' : 'TEXT'}${k === 'id' ? ' PRIMARY KEY' : ''}`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS ${table} (${defs.join(', ')})`);
}
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_band_incident ON band_messages(incident_id);
CREATE INDEX IF NOT EXISTS idx_llm_created ON llm_calls(created_at);`);

function toRow(table: string, obj: Record<string, any>) {
  const cols = TABLES[table];
  const row: Record<string, any> = {};
  for (const [k, t] of Object.entries(cols)) {
    if (!(k in obj)) continue;
    const v = obj[k];
    row[snake(k)] = v === undefined ? null : t === 'json' ? JSON.stringify(v ?? null) : typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  return row;
}
function fromRow<T>(table: string, row: any): T {
  if (!row) return row;
  const cols = TABLES[table];
  const out: any = {};
  for (const [k, t] of Object.entries(cols)) {
    const v = row[snake(k)];
    out[k] = t === 'json' ? (v == null ? null : JSON.parse(v)) : v;
  }
  if (table === 'llm_calls') { out.fallback = !!out.fallback; out.ok = !!out.ok; }
  return out as T;
}

export const db = {
  insert<T extends Record<string, any>>(table: string, obj: T): T {
    const row = toRow(table, obj);
    const keys = Object.keys(row);
    sqlite.prepare(`INSERT OR REPLACE INTO ${table} (${keys.map(quote).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...(Object.values(row) as any[]));
    return obj;
  },
  update<T>(table: string, id: string, patch: Partial<T>): T {
    const row = toRow(table, patch as any);
    delete row.id;
    const keys = Object.keys(row);
    if (keys.length) sqlite.prepare(`UPDATE ${table} SET ${keys.map((k) => `${quote(k)} = ?`).join(', ')} WHERE id = ?`).run(...(Object.values(row) as any[]), id);
    return db.get<T>(table, id)!;
  },
  get<T>(table: string, id: string): T | undefined {
    return fromRow<T>(table, sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
  },
  list<T>(table: string, where = '', params: any[] = [], order = '', limit = 500): T[] {
    const sql = `SELECT * FROM ${table} ${where ? 'WHERE ' + where : ''} ${order ? 'ORDER BY ' + order : ''} LIMIT ${limit}`;
    return (sqlite.prepare(sql).all(...params) as any[]).map((r) => fromRow<T>(table, r));
  },
  count(table: string, where = '', params: any[] = []): number {
    return Number((sqlite.prepare(`SELECT COUNT(*) as c FROM ${table} ${where ? 'WHERE ' + where : ''}`).get(...params) as any).c);
  },
  raw(sql: string, params: any[] = []): any[] {
    return sqlite.prepare(sql).all(...params) as any[];
  },
  kvGet<T>(key: string, fallback: T): T {
    const r = db.get<{ id: string; value: T }>('kv', key);
    return r ? r.value : fallback;
  },
  kvSet(key: string, value: any) { db.insert('kv', { id: key, value }); },
  schema(): string {
    return (sqlite.prepare(`SELECT sql FROM sqlite_master WHERE type='table'`).all() as any[]).map((r) => r.sql + ';').join('\n');
  },
};
