import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, ChevronRight, Pencil, Plus, Save, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { useHaven } from '../../lib/store';
import type { WikiEntry } from '../../lib/types';
import { AgentAvatar, FounderAvatar } from '../Avatar';
import { Badge, Button, Empty, Spinner, TimeAgo, ToolChip } from '../ui';
import { pushToast } from '../workforce/shared';

const CAT_COLORS = ['#facc15', '#22d3ee', '#f472b6', '#a78bfa', '#34d399', '#fb923c', '#60a5fa', '#a3e635'];
const catColor = (c: string) => { let h = 0; for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return CAT_COLORS[h % CAT_COLORS.length]; };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || `entry-${Date.now().toString(36)}`;

interface Draft { id: string | null; title: string; body: string; category: string }

function Editor({ draft, categories, onCancel, onSaved }: { draft: Draft; categories: string[]; onCancel: () => void; onSaved: (e: WikiEntry) => void }) {
  const [d, setD] = useState(draft);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!d.title.trim() || !d.body.trim()) { pushToast('warn', 'Title and body are required'); return; }
    setSaving(true);
    try {
      const id = d.id ?? slug(d.title);
      const saved = await api.put<WikiEntry>(`/api/wiki/${encodeURIComponent(id)}`, { title: d.title.trim(), body: d.body, category: d.category.trim() || 'General' });
      pushToast('success', 'Wiki updated', `“${d.title.trim()}” — every AI employee reads this before deciding.`, 'iris');
      onSaved(saved && saved.id ? saved : { id, title: d.title.trim(), body: d.body, category: d.category.trim() || 'General', updatedBy: 'founder', updatedAt: Date.now() });
    } catch (e: any) {
      pushToast('error', 'Could not save wiki entry', String(e?.message ?? e));
    } finally { setSaving(false); }
  };
  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Title"
        className="w-full rounded-lg border border-line-strong bg-ink-950/70 px-2.5 py-1.5 text-sm outline-none focus:border-yellow-300/50" />
      <input value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} placeholder="Category" list="wiki-categories"
        className="w-full rounded-lg border border-line-strong bg-ink-950/70 px-2.5 py-1.5 text-xs outline-none focus:border-yellow-300/50" />
      <datalist id="wiki-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <textarea value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} rows={8} placeholder="What should every AI employee know?"
        className="w-full rounded-lg border border-line-strong bg-ink-950/70 px-2.5 py-2 text-[12.5px] leading-relaxed mono outline-none focus:border-yellow-300/50 resize-y scroll-thin" />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={saving} icon={saving ? <Spinner /> : <Save size={13} />}>Save</Button>
      </div>
    </div>
  );
}

export function WikiPanel() {
  const [entries, setEntries] = useState<WikiEntry[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // entry id, or '__new__'
  const [q, setQ] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const workforce = useHaven((s) => s.workforce);
  // Rex/Juno/Iris write to the wiki as they work — refresh when their BAND traffic mentions it.
  const wikiPulse = useHaven((s) => s.band.filter((b) => /wiki|blocklist|policy|indicator/i.test(`${b.subject} ${b.body}`)).length);

  const load = useCallback(async () => {
    try { const list = await api.get<WikiEntry[]>('/api/wiki'); setEntries(Array.isArray(list) ? list : []); } catch { setEntries((e) => e ?? []); }
  }, []);
  useEffect(() => { void load(); }, [load, wikiPulse]);
  useEffect(() => {
    if (editing) return;
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [editing, load]);

  const categories = useMemo(() => Array.from(new Set((entries ?? []).map((e) => e.category))).sort(), [entries]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (entries ?? []).slice().sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    return needle ? list.filter((e) => `${e.title} ${e.body} ${e.category}`.toLowerCase().includes(needle)) : list;
  }, [entries, q]);

  const onSaved = (e: WikiEntry) => {
    setEntries((prev) => { const list = (prev ?? []).filter((x) => x.id !== e.id); return [...list, e]; });
    setEditing(null); setOpen(e.id); setFlash(e.id);
    setTimeout(() => setFlash(null), 1600);
  };

  const by = (who: string) => {
    if (workforce.some((w) => w.id === who)) return <span className="inline-flex items-center gap-1"><AgentAvatar id={who} size={14} showStatus={false} />{workforce.find((w) => w.id === who)?.name}</span>;
    if (who === 'founder') return <span className="inline-flex items-center gap-1"><FounderAvatar size={14} />you</span>;
    return <span>{who}</span>;
  };

  return (
    <section className="panel flex flex-col flex-1 min-h-0 overflow-hidden">
      <header className="px-4 pt-3.5 pb-3 border-b border-line">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-fg/90 uppercase"><BookOpen size={14} className="text-muted" />Shared context wiki</h3>
          <div className="flex items-center gap-1.5"><ToolChip id="promptql" />
            <button onClick={() => { setEditing('__new__'); setOpen(null); }} title="New entry"
              className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/[0.06] cursor-pointer"><Plus size={15} /></button>
          </div>
        </div>
        <p className="text-xs text-muted mt-1.5 leading-relaxed">Every AI employee reads this wiki before deciding — edit a policy here and Nova, Rex, Mira and the rest act on it on their very next message.</p>
        <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-line bg-ink-950/50 px-2.5 py-1.5">
          <Search size={13} className="text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the wiki…" className="flex-1 bg-transparent outline-none text-xs placeholder:text-dim" />
          {q && <button onClick={() => setQ('')} className="text-dim hover:text-fg cursor-pointer"><X size={12} /></button>}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-2">
        <AnimatePresence>
          {editing === '__new__' && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="m-1 mb-2 rounded-xl border border-yellow-300/30 bg-yellow-300/[0.04] p-3">
                <div className="text-[11px] uppercase tracking-wider text-yellow-200/80 mb-2">New entry</div>
                <Editor draft={{ id: null, title: '', body: '', category: categories[0] ?? 'Policy' }} categories={categories} onCancel={() => setEditing(null)} onSaved={onSaved} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {entries === null ? (
          <div className="space-y-2 p-1">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-12 rounded-xl shimmer border border-line" />)}</div>
        ) : filtered.length === 0 ? (
          <Empty icon={<BookOpen size={20} />} title={q ? 'No matching entries' : 'The wiki is empty'} body={q ? 'Try a different search.' : 'Add the first policy, glossary term or runbook with the + button.'} />
        ) : (
          <ul className="space-y-1">
            {filtered.map((e) => {
              const isOpen = open === e.id;
              const isEditing = editing === e.id;
              const color = catColor(e.category);
              return (
                <motion.li key={e.id} layout
                  animate={flash === e.id ? { backgroundColor: ['rgba(250,204,21,0.18)', 'rgba(250,204,21,0)'] } : {}}
                  transition={{ duration: 1.4 }}
                  className={clsx('rounded-xl border transition-colors', isOpen ? 'border-line-strong bg-white/[0.03]' : 'border-transparent hover:bg-white/[0.025]')}>
                  <button onClick={() => { if (!isEditing) setOpen(isOpen ? null : e.id); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-left cursor-pointer">
                    <ChevronRight size={13} className={clsx('text-dim transition-transform shrink-0', isOpen && 'rotate-90')} />
                    <span className="flex-1 min-w-0 text-[13px] font-medium truncate">{e.title}</span>
                    <Badge color={color}>{e.category}</Badge>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="px-3 pb-3 pl-8">
                          {isEditing ? (
                            <Editor draft={{ id: e.id, title: e.title, body: e.body, category: e.category }} categories={categories} onCancel={() => setEditing(null)} onSaved={onSaved} />
                          ) : (
                            <>
                              <div className="text-[12.5px] text-fg/80 leading-relaxed whitespace-pre-wrap break-words max-h-[260px] overflow-y-auto scroll-thin">{e.body}</div>
                              <div className="mt-2.5 flex items-center justify-between gap-2 text-[10.5px] text-dim">
                                <span className="inline-flex items-center gap-1">updated by {by(e.updatedBy)} · <TimeAgo ts={e.updatedAt} /></span>
                                <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={() => setEditing(e.id)}>Edit</Button>
                              </div>
                            </>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="px-4 py-2 border-t border-line text-[10.5px] text-dim flex items-center justify-between">
        <span>{entries?.length ?? 0} entries · {categories.length} categories</span>
        <span className="inline-flex items-center gap-1">maintained by <AgentAvatar id="iris" size={14} showStatus={false} /> Iris</span>
      </div>
    </section>
  );
}
