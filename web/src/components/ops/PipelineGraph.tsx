import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, BaseEdge, Controls, Handle, MarkerType, Position,
  type Edge, type EdgeProps, type EdgeTypes, type Node, type NodeProps, type NodeTypes, type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import clsx from 'clsx';
import {
  Activity, Braces, BrainCircuit, Bug, ClipboardCheck, Database, EyeOff, FileText, FlaskConical, Funnel, Globe, MessageSquare,
  MessageSquareText, Monitor, ScanText, Send, ShieldCheck, Webhook, type LucideIcon,
} from 'lucide-react';
import type { PipelineDef, PipelineRun, PipelineStageState } from '../../lib/types';
import { TOOL_META, fmtMs } from '../ui';
import { RUN_STATUS_COLOR } from './shared';

// ---------------------------------------------------------------------------------------------- stage metadata

const PROVIDER: Record<string, { icon: LucideIcon; label: string; color: string }> = {
  webhook: { icon: Webhook, label: 'webhook', color: '#22d3ee' },
  chat: { icon: MessageSquare, label: 'chat', color: '#22d3ee' },
  anonymize_text: { icon: EyeOff, label: 'anonymize_text', color: '#34d399' },
  ner: { icon: ScanText, label: 'ner', color: '#60a5fa' },
  guardrails: { icon: ShieldCheck, label: 'guardrails', color: '#f59e0b' },
  prompt: { icon: FileText, label: 'prompt', color: '#a78bfa' },
  question: { icon: Database, label: 'question', color: '#facc15' },
  llm_openai: { icon: BrainCircuit, label: 'llm_openai', color: '#c084fc' },
  extract_data: { icon: Funnel, label: 'extract_data', color: '#38bdf8' },
  anomaly_detector: { icon: Activity, label: 'anomaly_detector', color: '#fb7185' },
  tool_http_request: { icon: Globe, label: 'tool_http_request', color: '#f97316' },
  response_json: { icon: Braces, label: 'response_json', color: '#10b981' },
  response_answers: { icon: MessageSquareText, label: 'response_answers', color: '#10b981' },
};

/** Which sponsor tool actually powers a given stage. */
export function stageTools(pipelineId: string, stageId: string, type: string): string[] {
  const key = `${pipelineId}/${stageId}`;
  const special: Record<string, string[]> = {
    'link-forensics/tool_http_request_1': ['celesto', 'adal'],
    'bot-audit/tool_http_request_1': ['snyk'],
    'bot-audit/tool_http_request_2': ['tenki'],
    'bot-audit/guardrails_1': ['prelint'],
    'community-insights/question_1': ['promptql'],
  };
  if (special[key]) return special[key];
  if (type === 'llm_openai') return ['flatkey'];
  return ['rocketride'];
}

export function stageIcon(pipelineId: string, stageId: string, type: string): LucideIcon {
  const key = `${pipelineId}/${stageId}`;
  if (key === 'link-forensics/tool_http_request_1') return Monitor;
  if (key === 'bot-audit/tool_http_request_1') return Bug;
  if (key === 'bot-audit/tool_http_request_2') return FlaskConical;
  if (key === 'bot-audit/guardrails_1') return ClipboardCheck;
  return PROVIDER[type]?.icon ?? Send;
}
export const providerColor = (type: string) => PROVIDER[type]?.color ?? '#8d93a8';

// ---------------------------------------------------------------------------------------------- layout

const COL_W = 250, ROW_H = 200;

/** Longest-path depth from sources → column. Long chains snake onto a second row (left→right, then right→left). */
export function layoutStages(def: PipelineDef) {
  const ids = def.stages.map((s) => s.id);
  const preds = new Map<string, string[]>(ids.map((i) => [i, []]));
  for (const [a, b] of def.edges) if (preds.has(b) && ids.includes(a)) preds.get(b)!.push(a);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const d = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const p = preds.get(id) ?? [];
    const v = p.length ? Math.max(...p.map(d)) + 1 : 0;
    visiting.delete(id);
    depth.set(id, v);
    return v;
  };
  ids.forEach(d);
  const cols = new Map<number, string[]>();
  for (const id of ids) { const k = depth.get(id)!; cols.set(k, [...(cols.get(k) ?? []), id]); }
  const nCols = cols.size;
  const perRow = nCols > 5 ? Math.ceil(nCols / 2) : nCols;
  const maxStack = Math.max(1, ...[...cols.values()].map((c) => c.length));
  const pos: Record<string, { x: number; y: number; row: number }> = {};
  for (const [k, col] of cols) {
    const row = Math.floor(k / perRow);
    const j = k % perRow;
    const x = (row % 2 === 0 ? j : perRow - 1 - j) * COL_W;
    col.forEach((id, i) => { pos[id] = { x, y: row * ROW_H * maxStack + (i - (col.length - 1) / 2) * 130, row }; });
  }
  return pos;
}

// ---------------------------------------------------------------------------------------------- node

type StageData = {
  pipelineId: string; stageId: string; name: string; type: string; status: PipelineStageState['status'] | 'idle';
  durationMs: number | null; picked: boolean;
};
type StageNode = Node<StageData, 'stage'>;

const HANDLE_CLS = '!w-1.5 !h-1.5 !min-w-0 !min-h-0 !border-0 !bg-white/25';
const StageNodeView = memo(function StageNodeView({ data }: NodeProps<StageNode>) {
  const Icon = stageIcon(data.pipelineId, data.stageId, data.type);
  const color = providerColor(data.type);
  const st = data.status;
  const sc = st === 'idle' ? '#5d6379' : RUN_STATUS_COLOR[st] ?? '#5d6379';
  const tools = stageTools(data.pipelineId, data.stageId, data.type);
  return (
    <div className={clsx('relative w-[200px] rounded-2xl border px-3 py-2.5 backdrop-blur-xl transition-[border-color,box-shadow] duration-300 cursor-pointer',
      data.picked ? 'ring-2 ring-white/40' : '')}
      style={{
        borderColor: st === 'idle' || st === 'pending' ? 'rgba(255,255,255,0.10)' : `${sc}aa`,
        boxShadow: st === 'running' ? `0 0 0 1px ${sc}, 0 0 28px -2px ${sc}aa` : st === 'done' ? `0 0 20px -10px ${sc}` : st === 'error' ? `0 0 24px -6px ${sc}` : '0 12px 30px -18px rgba(0,0,0,0.8)',
        background: 'linear-gradient(180deg, rgba(30,34,52,0.92), rgba(14,17,26,0.92))',
      }}>
      {st === 'running' && <span className="absolute inset-0 rounded-2xl animate-pulse" style={{ background: `${sc}14` }} />}
      <Handle id="l" type="target" position={Position.Left} className={HANDLE_CLS} />
      <Handle id="t" type="target" position={Position.Top} className={HANDLE_CLS} />
      <Handle id="rt" type="target" position={Position.Right} className={HANDLE_CLS} />
      <div className="relative flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0" style={{ background: `${color}22`, color }}><Icon size={14} /></span>
        <span className="mono text-[9.5px] text-muted truncate flex-1">{data.type}</span>
        <span className="relative inline-flex w-2.5 h-2.5">
          {st === 'running' && <span className="absolute inset-0 rounded-full animate-ping" style={{ background: sc }} />}
          <span className="relative w-2.5 h-2.5 rounded-full" style={{ background: sc }} />
        </span>
      </div>
      <div className="relative mt-1.5 text-[12.5px] font-medium leading-snug text-fg line-clamp-2">{data.name}</div>
      <div className="relative mt-2 flex items-center gap-1 flex-wrap">
        {tools.map((t) => {
          const m = TOOL_META[t] ?? { name: t, color: '#8d93a8' };
          return <span key={t} className="mono text-[9.5px] font-semibold rounded px-1 py-[1px] border" style={{ color: m.color, borderColor: `${m.color}40`, background: `${m.color}12` }}>{m.name}</span>;
        })}
        <span className="flex-1" />
        <span className="mono text-[10px] tabular-nums" style={{ color: sc }}>
          {st === 'running' ? 'running' : st === 'done' || st === 'error' ? fmtMs(data.durationMs) : st === 'skipped' ? 'skipped' : st === 'pending' ? 'queued' : ''}
        </span>
      </div>
      <Handle id="r" type="source" position={Position.Right} className={HANDLE_CLS} />
      <Handle id="b" type="source" position={Position.Bottom} className={HANDLE_CLS} />
      <Handle id="ls" type="source" position={Position.Left} className={HANDLE_CLS} />
    </div>
  );
});

const nodeTypes: NodeTypes = { stage: StageNodeView };

/** Edges that skip columns within a row arc over it instead of cutting through nodes. */
function SkipEdge({ sourceX, sourceY, targetX, targetY, style, markerEnd }: EdgeProps) {
  const lift = 120;
  const dir = targetX >= sourceX ? 1 : -1;
  const path = `M ${sourceX},${sourceY} C ${sourceX + dir * 90},${sourceY - lift} ${targetX - dir * 90},${targetY - lift} ${targetX},${targetY}`;
  return <BaseEdge path={path} style={style} markerEnd={markerEnd} />;
}
const edgeTypes: EdgeTypes = { skip: SkipEdge };

// ---------------------------------------------------------------------------------------------- graph

export function PipelineGraph({ def, run, selectedStage, onSelect }: {
  def: PipelineDef; run: PipelineRun | null; selectedStage: string | null; onSelect: (stageId: string | null) => void;
}) {
  const pos = useMemo(() => layoutStages(def), [def]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rf, setRf] = useState<ReactFlowInstance<StageNode, Edge> | null>(null);
  const stageState = useMemo(() => {
    const m: Record<string, PipelineStageState> = {};
    for (const s of run?.stages ?? []) m[s.id] = s;
    return m;
  }, [run]);

  // Keep the whole graph in frame whenever the container resizes (sidebar inspector, window resize).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !rf) return;
    let raf = 0;
    const fit = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { void rf.fitView({ padding: 0.12, maxZoom: 1.05 }); }); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [rf, def.id]);

  const nodes: StageNode[] = useMemo(() => def.stages.map((s) => {
    const st = stageState[s.id];
    const dur = st?.startedAt && st?.finishedAt ? st.finishedAt - st.startedAt : null;
    const p = pos[s.id] ?? { x: 0, y: 0 };
    return {
      id: s.id, type: 'stage', position: { x: p.x, y: p.y }, draggable: false, selectable: true,
      data: { pipelineId: def.id, stageId: s.id, name: s.name, type: s.type, status: st?.status ?? 'idle', durationMs: dur, picked: selectedStage === s.id },
    };
  }), [def, pos, stageState, selectedStage]);

  const edges: Edge[] = useMemo(() => def.edges.map(([a, b]) => {
    const sa = stageState[a]?.status, sb = stageState[b]?.status;
    const live = run?.status === 'running' && (sb === 'running' || (sa === 'done' && sb === 'pending'));
    const done = sa === 'done' && (sb === 'done' || sb === 'running');
    const err = sb === 'error';
    const color = err ? '#f43f5e' : live ? '#a78bfa' : done ? '#10b981' : 'rgba(255,255,255,0.22)';
    const pa = pos[a] ?? { x: 0, y: 0, row: 0 }, pb = pos[b] ?? { x: 0, y: 0, row: 0 };
    const sameRow = pa.row === pb.row;
    const span = Math.round(Math.abs(pb.x - pa.x) / COL_W);
    const ltr = pb.x >= pa.x;
    const handles = !sameRow ? { sourceHandle: 'b', targetHandle: 't' } : ltr ? { sourceHandle: 'r', targetHandle: 'l' } : { sourceHandle: 'ls', targetHandle: 'rt' };
    const straight = sameRow && Math.abs(pb.y - pa.y) < 1;
    return {
      id: `${a}->${b}`, source: a, target: b, ...handles, type: span > 1 && straight ? 'skip' : 'smoothstep',
      animated: run?.status === 'running',
      style: { stroke: color, strokeWidth: live ? 2.4 : 1.6, opacity: done || live ? 1 : 0.7 },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    };
  }), [def, pos, stageState, run?.status]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <ReactFlow<StageNode, Edge>
        key={def.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode="dark"
        onInit={setRf}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1.05 }}
        minZoom={0.3}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        zoomOnScroll={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => onSelect(n.id === selectedStage ? null : n.id)}
        onPaneClick={() => onSelect(null)}
        style={{ background: 'transparent' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgba(255,255,255,0.09)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
