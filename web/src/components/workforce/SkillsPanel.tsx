import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FileCode2, Sparkle } from 'lucide-react';
import { api } from '../../lib/api';
import { useHaven } from '../../lib/store';
import type { Employee, Skill } from '../../lib/types';
import { AgentAvatar } from '../Avatar';
import { Badge, Empty, Panel, Spinner, Tabs, ToolChip } from '../ui';
import { Switch, normalizeSkills, pushToast } from './shared';

export function SkillsPanel({ emp }: { emp: Employee }) {
  const workforce = useHaven((s) => s.workforce);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [view, setView] = useState<'mine' | 'all'>('mine');
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSkills(null);
    api.get('/api/skills').then((s) => { if (alive) setSkills(normalizeSkills(s)); }).catch(() => { if (alive) setSkills([]); });
    return () => { alive = false; };
  }, [emp.id]);

  const list = useMemo(() => {
    const all = skills ?? [];
    const mine = all.filter((s) => s.enabledFor.includes(emp.id) || s.owner === emp.id || emp.skills.includes(s.id));
    // Stable order (owned → default → alphabetical) so rows don't jump around when toggled.
    const rank = (s: Skill) => (s.owner === emp.id ? 2 : 0) + (emp.skills.includes(s.id) ? 1 : 0);
    return (view === 'mine' ? mine : all).slice().sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
  }, [skills, view, emp.id, emp.skills]);
  const enabledCount = (skills ?? []).filter((s) => s.enabledFor.includes(emp.id)).length;

  const toggle = async (skill: Skill, enabled: boolean) => {
    const apply = (on: boolean) => setSkills((prev) => (prev ?? []).map((s) => (s.id === skill.id
      ? { ...s, enabledFor: on ? Array.from(new Set([...s.enabledFor, emp.id])) : s.enabledFor.filter((a) => a !== emp.id) } : s)));
    apply(enabled);
    setSaving(skill.id);
    try {
      await api.post(`/api/agents/${emp.id}/skills`, { skillId: skill.id, enabled });
      pushToast('success', `${skill.name} ${enabled ? 'enabled' : 'disabled'} for ${emp.name}`, enabled ? 'Its instructions are now injected into every prompt.' : 'Removed from this employee\'s prompts.', emp.id);
    } catch (e: any) {
      apply(!enabled);
      pushToast('error', 'Could not update skill', String(e?.message ?? e), emp.id);
    } finally { setSaving(null); }
  };

  return (
    <Panel title="Skills" icon={<Sparkle size={14} />}
      actions={<><span className="text-[11px] text-muted mono">{enabledCount} on</span><ToolChip id="finch" /></>}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <Tabs value={view} onChange={setView} items={[{ id: 'mine', label: `${emp.name}'s skills` }, { id: 'all', label: `All skills${skills ? ` (${skills.length})` : ''}` }]} />
        <span className="text-[11px] text-dim hidden md:inline">Versioned SKILL.md files, injected into prompts</span>
      </div>
      {skills === null ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl shimmer border border-line" />)}</div>
      ) : list.length === 0 ? (
        <Empty icon={<Sparkle size={20} />} title="No skills yet" body={view === 'mine' ? `Switch to "All skills" to give ${emp.name} a new capability.` : 'No Finch skills were found in skills/.'} />
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {list.map((s) => {
              const on = s.enabledFor.includes(emp.id);
              const owner = workforce.find((w) => w.id === s.owner);
              return (
                <motion.li key={s.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="rounded-xl border px-3 py-2.5 flex items-start gap-3 transition-colors"
                  style={{ borderColor: on ? `${emp.color}44` : 'rgba(255,255,255,0.08)', background: on ? `${emp.color}0d` : 'rgba(255,255,255,0.015)' }}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium capitalize">{s.name}</span>
                      {(s as any).version && <span className="mono text-[10px] text-dim">v{(s as any).version}</span>}
                      {owner && (
                        <span className="inline-flex items-center gap-1 text-[10.5px] text-muted"><AgentAvatar id={owner.id} size={14} showStatus={false} />by {owner.name}</span>
                      )}
                      {s.enabledFor.length > 0 && <Badge color="#8d93a8">{s.enabledFor.length} employee{s.enabledFor.length === 1 ? '' : 's'}</Badge>}
                    </div>
                    <div className="text-xs text-muted mt-0.5 leading-snug">{s.description}</div>
                    {s.path && <div className="mt-1 inline-flex items-center gap-1 mono text-[10px] text-dim"><FileCode2 size={10} />{s.path}</div>}
                  </div>
                  <div className="flex items-center gap-2 pt-0.5">
                    {saving === s.id && <Spinner />}
                    <Switch on={on} onChange={(v) => toggle(s, v)} color={emp.color} disabled={saving === s.id} label={`Toggle ${s.name}`} />
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </Panel>
  );
}
