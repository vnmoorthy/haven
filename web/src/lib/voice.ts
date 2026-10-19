import type { Employee } from './types';

// Masky gives every AI employee a voice. If the server returns a Masky audio URL we play it;
// otherwise we fall back to the browser's speech engine with a per-employee voice profile.

let voices: SpeechSynthesisVoice[] = [];
const loadVoices = () => { voices = window.speechSynthesis?.getVoices() ?? []; };
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

export const speakingListeners = new Set<(agentId: string | null) => void>();
let current: string | null = null;
const setSpeaking = (id: string | null) => { current = id; speakingListeners.forEach((l) => l(id)); };
export const currentSpeaker = () => current;

function pickVoice(emp?: Employee) {
  if (!voices.length) loadVoices();
  const en = voices.filter((v) => v.lang?.startsWith('en'));
  for (const name of emp?.voice.preferred ?? []) {
    const v = en.find((x) => x.name.includes(name));
    if (v) return v;
  }
  return en[0] ?? voices[0];
}

export function speak(text: string, emp: Employee | undefined, audioUrl?: string, onEnd?: () => void) {
  let finished = false;
  const done = () => { if (finished) return; finished = true; setSpeaking(null); onEnd?.(); };
  // Safety net: some browsers never fire speech events (autoplay policy, no voices) — never leave a caption stuck.
  setTimeout(done, Math.min(30000, 2500 + text.length * 75));
  if (audioUrl) {
    const a = new Audio(audioUrl);
    setSpeaking(emp?.id ?? null);
    a.onended = done; a.onerror = done;
    void a.play().catch(done);
    return;
  }
  if (!('speechSynthesis' in window)) { setTimeout(done, 4000); return; }
  const u = new SpeechSynthesisUtterance(text.replace(/[*_#`>]/g, ''));
  const v = pickVoice(emp);
  if (v) u.voice = v;
  u.pitch = emp?.voice.pitch ?? 1;
  u.rate = emp?.voice.rate ?? 1;
  u.onstart = () => setSpeaking(emp?.id ?? null);
  u.onend = done; u.onerror = done;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() { window.speechSynthesis?.cancel(); setSpeaking(null); }
