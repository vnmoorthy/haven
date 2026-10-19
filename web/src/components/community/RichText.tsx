import { Fragment, type ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';

// Minimal chat-text renderer: **bold**, @mentions and links. Links in risky messages are rendered inert.
const TOKEN = /(\*\*[^*\n]+\*\*|https?:\/\/[^\s<>"']+|@[a-z0-9_.]+[a-z0-9_])/gi;
const TRAIL = /[.,!?;:)\]]+$/;

export function RichText({ text, dangerous = false }: { text: string; dangerous?: boolean }) {
  const parts = text.split(TOKEN);
  const out: ReactNode[] = [];
  parts.forEach((p, i) => {
    if (!p) return;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) {
      out.push(<strong key={i} className="font-semibold text-white">{p.slice(2, -2)}</strong>);
    } else if (/^https?:\/\//i.test(p)) {
      const trail = p.match(TRAIL)?.[0] ?? '';
      const url = trail ? p.slice(0, -trail.length) : p;
      out.push(
        <Fragment key={i}>
          {dangerous ? (
            <span className="inline-flex items-center gap-1 text-rose-300 underline decoration-dotted decoration-rose-400/60 break-all" title="Link disabled by Haven — flagged as unsafe">
              <ShieldAlert size={12} className="shrink-0" />{url}
            </span>
          ) : (
            <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-sky-300 hover:underline break-all" onClick={(e) => e.stopPropagation()}>{url}</a>
          )}
          {trail}
        </Fragment>,
      );
    } else if (p.startsWith('@') && p.length > 1) {
      out.push(<span key={i} className="rounded px-1 py-px bg-brand-violet/20 text-violet-200 font-medium">{p}</span>);
    } else {
      out.push(<Fragment key={i}>{p}</Fragment>);
    }
  });
  return <span className="whitespace-pre-wrap break-words">{out}</span>;
}
