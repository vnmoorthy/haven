import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { UserX } from 'lucide-react';
import { api } from '../lib/api';
import { useHaven } from '../lib/store';
import { Button, Empty } from '../components/ui';
import { AgentAvatar } from '../components/Avatar';
import { ProfileHero, ResponsibilitiesPanel, ToolsPanel } from '../components/workforce/ProfileHero';
import { SkillsPanel } from '../components/workforce/SkillsPanel';
import { MemoryPanel } from '../components/workforce/MemoryPanel';
import { BandPanel, LlmPanel } from '../components/workforce/ActivityPanels';
import { ChatPanel, useAgentChat } from '../components/workforce/ChatPanel';
import { normalizeDetail, pushToast, useAgentPulse, useDebounced, type AgentDetail } from '../components/workforce/shared';

const INTRO_PROMPT = 'Introduce yourself in 2 sentences to the founder.';

const rise = (i: number) => ({ initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.45, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] as const } });

export default function EmployeeProfile() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const ready = useHaven((s) => s.ready);
  const emp = useHaven((s) => s.workforce.find((w) => w.id === id));
  const workforce = useHaven((s) => s.workforce);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [introPending, setIntroPending] = useState(false);
  const chat = useAgentChat(id);
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    if (!id) return;
    const n = ++reqSeq.current;
    try {
      const raw = await api.get(`/api/agents/${id}`);
      if (n === reqSeq.current) { setDetail(normalizeDetail(raw)); setError(null); }
    } catch (e: any) {
      if (n === reqSeq.current) setError(String(e?.message ?? e));
    }
  }, [id]);

  useEffect(() => { setDetail(null); setError(null); }, [id]);

  // Live: re-fetch whenever BAND traffic, model calls or incidents involving this employee change.
  const pulse = useDebounced(useAgentPulse(id), 700);
  const exists = !!emp;
  useEffect(() => { if (exists) void load(); }, [load, pulse, exists]);

  const intro = async () => {
    if (!emp) return;
    const st = useHaven.getState();
    if (!st.voiceOn) { st.setVoice(true); pushToast('info', 'Voices turned on', `${emp.name} will speak through Masky.`, emp.id); }
    setIntroPending(true);
    try { await chat.send(INTRO_PROMPT, { note: 'Voice intro · Masky' }); } finally { setIntroPending(false); }
  };

  if (!emp) {
    if (!ready) return null;
    return (
      <div className="max-w-xl mx-auto mt-16 panel">
        <Empty icon={<UserX size={28} />} title={`No employee called "${id}"`} body="This AI employee doesn't exist (yet). Meet the team instead."
          action={<div className="flex flex-col items-center gap-3">
            <div className="flex -space-x-2">{workforce.map((w) => <AgentAvatar key={w.id} id={w.id} size={30} showStatus={false} className="ring-2 ring-ink-900 rounded-full" />)}</div>
            <Button variant="primary" onClick={() => nav('/workforce')}>Back to AI Workforce</Button>
          </div>} />
      </div>
    );
  }

  const stats = detail?.stats ?? {};

  return (
    <div className="max-w-[1700px] mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] min-[1500px]:grid-cols-[minmax(0,1fr)_420px] gap-4 items-start">
        <div className="min-w-0 space-y-4">
          <motion.div {...rise(0)}>
            <ProfileHero emp={emp} stats={stats} onIntro={intro} introPending={introPending} />
          </motion.div>

          {error && !detail && (
            <div className="panel p-4 text-sm flex items-center justify-between gap-3 border-danger/40">
              <span className="text-rose-200">Couldn't load {emp.name}'s live profile: {error}</span>
              <Button size="sm" onClick={() => void load()}>Retry</Button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <motion.div {...rise(1)}><ResponsibilitiesPanel emp={emp} /></motion.div>
            <motion.div {...rise(2)}><ToolsPanel emp={emp} /></motion.div>
          </div>

          <motion.div {...rise(3)}>
            {detail ? (
              <MemoryPanel emp={emp} memory={detail.memory} compressions={detail.compressions} onCompressed={() => void load()} />
            ) : (
              <div className="panel h-[220px] shimmer" />
            )}
          </motion.div>

          <motion.div {...rise(4)}><SkillsPanel emp={emp} /></motion.div>

          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
            <motion.div {...rise(5)} className="min-w-0">
              {detail ? <BandPanel emp={emp} items={detail.recentBand} /> : <div className="panel h-[260px] shimmer" />}
            </motion.div>
            <motion.div {...rise(6)} className="min-w-0">
              {detail ? <LlmPanel emp={emp} items={detail.recentLlm} stats={stats} /> : <div className="panel h-[260px] shimmer" />}
            </motion.div>
          </div>
        </div>

        <motion.div {...rise(2)} className="lg:sticky lg:top-20">
          <ChatPanel emp={emp} chat={chat} className="h-[640px] lg:h-[calc(100vh-7rem)]" />
        </motion.div>
      </div>
    </div>
  );
}
