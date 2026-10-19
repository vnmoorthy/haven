import { customAlphabet } from 'nanoid';

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);
export const id = (prefix: string) => `${prefix}_${nano()}`;
export const now = () => Date.now();
export const estTokens = (s: string) => Math.max(1, Math.ceil((s || '').length / 4));
export const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;
export function extractJson<T = any>(text: string): T | null {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.search(/[\[{]/);
  if (start < 0) return null;
  for (let end = body.length; end > start; end--) {
    const ch = body[end - 1];
    if (ch !== '}' && ch !== ']') continue;
    try { return JSON.parse(body.slice(start, end)); } catch { /* keep shrinking */ }
  }
  return null;
}
