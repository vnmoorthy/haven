// Thin REST client. In "replay" (static GitHub Pages) mode requests are served by the in-browser demo engine.
import { replay } from './replay';

export const IS_REPLAY = import.meta.env.MODE === 'pages' || new URLSearchParams(location.search).has('replay');
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

async function req<T>(method: string, path: string, body?: any): Promise<T> {
  if (IS_REPLAY) return replay.request<T>(method, path, body);
  const res = await fetch(`${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  get: <T = any>(path: string) => req<T>('GET', path),
  post: <T = any>(path: string, body?: any) => req<T>('POST', path, body ?? {}),
  put: <T = any>(path: string, body?: any) => req<T>('PUT', path, body ?? {}),
};

/** Resolve server-hosted asset paths (forensics screenshots, lab pages) for both live and replay builds. */
export const asset = (p: string | null | undefined) => (!p ? '' : IS_REPLAY ? `${BASE}/replay${p}` : p);
