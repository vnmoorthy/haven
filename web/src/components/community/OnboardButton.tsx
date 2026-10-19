import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { AgentAvatar } from '../Avatar';
import { Button, ToolChip } from '../ui';

/** Discord-style "add server": Leo onboards a new community through the n8n community-onboarding workflow. */
export function OnboardButton({ onDone }: { onDone?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('Lofi Study Hall');
  const [members, setMembers] = useState(5200);
  const [plan, setPlan] = useState<'Starter' | 'Growth' | 'Enterprise'>('Growth');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const c = await api.post<{ id: string }>('/api/communities', { name: name.trim(), members, plan, platform: 'Glimmer' });
      setOpen(false);
      if (c?.id) onDone?.(c.id);
    } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Onboard a new community (Leo · n8n)"
        className="grid place-items-center w-11 h-11 rounded-[22px] hover:rounded-[14px] transition-all duration-200 bg-ok/10 text-ok hover:bg-ok hover:text-white cursor-pointer">
        <Plus size={20} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div onClick={(e) => e.stopPropagation()} initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 10 }}
              className="panel bg-ink-850 w-[440px] p-6">
              <div className="flex items-center gap-3 mb-4">
                <AgentAvatar id="leo" size={44} />
                <div>
                  <div className="font-semibold">Onboard a community</div>
                  <div className="text-xs text-muted">Leo runs the n8n onboarding workflow: tenant, policy seed, welcome email, weekly report.</div>
                </div>
              </div>
              <label className="block text-xs text-muted mb-1">Community name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl bg-white/[0.04] border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand-violet mb-3" />
              <label className="block text-xs text-muted mb-1">Members</label>
              <input type="number" value={members} onChange={(e) => setMembers(Math.max(1, Number(e.target.value) || 1))} className="w-full rounded-xl bg-white/[0.04] border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand-violet mb-3" />
              <label className="block text-xs text-muted mb-1">Plan</label>
              <div className="grid grid-cols-3 gap-2 mb-5">
                {(['Starter', 'Growth', 'Enterprise'] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setPlan(p)}
                    className={`rounded-xl border px-2 py-2 text-xs cursor-pointer ${plan === p ? 'border-brand-violet bg-brand-violet/15 text-fg' : 'border-line text-muted hover:text-fg'}`}>
                    <div className="font-semibold">{p}</div>
                    <div className="mono text-[10.5px] mt-0.5">{p === 'Starter' ? '$49/mo' : p === 'Growth' ? '$299/mo' : '$1,200/mo'}</div>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5"><ToolChip id="n8n" /><ToolChip id="band" /></div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button variant="primary" disabled={busy} onClick={submit} icon={<Sparkles size={14} />}>{busy ? 'Onboarding…' : 'Onboard'}</Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
