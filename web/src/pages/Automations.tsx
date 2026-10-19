import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Rocket, Workflow } from 'lucide-react';
import { PageHeader, Tabs, ToolChip } from '../components/ui';
import { PipelinesTab } from '../components/ops/PipelinesTab';
import { N8nTab } from '../components/ops/N8nTab';
import { useHaven } from '../lib/store';

type Tab = 'pipelines' | 'n8n';

export default function Automations() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'n8n' ? 'n8n' : 'pipelines';
  const setTab = (t: Tab) => setParams(t === 'pipelines' ? {} : { tab: t }, { replace: true });
  const pipeRunning = useHaven((s) => Object.values(s.pipelineRuns).filter((r) => r.status === 'running').length);
  const flowRunning = useHaven((s) => Object.values(s.automationRuns).filter((r) => r.status === 'running').length);

  return (
    <div className="max-w-[1500px] mx-auto">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-2">Automation layer <ToolChip id="rocketride" /> <ToolChip id="n8n" /></span>}
        title={<>Pipelines <span className="text-gradient">&amp;</span> flows</>}
        subtitle="The machinery behind the AI workforce: RocketRide .pipe graphs do the AI work in real time, n8n workflows run the business — alerts, escalations, onboarding and reports. Every graph here is a real, importable file."
        actions={
          <Tabs<Tab> value={tab} onChange={setTab} items={[
            { id: 'pipelines', label: <span className="inline-flex items-center gap-1.5"><Rocket size={13} className="text-orange-400" /> RocketRide pipelines{pipeRunning > 0 && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />}</span> },
            { id: 'n8n', label: <span className="inline-flex items-center gap-1.5"><Workflow size={13} className="text-[#ea4b71]" /> n8n workflows{flowRunning > 0 && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />}</span> },
          ]} />
        }
      />
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
          {tab === 'pipelines' ? <PipelinesTab /> : <N8nTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
