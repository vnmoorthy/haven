// Generates the AI employee avatars used in the README (same DiceBear "notionists" seeds as the app).
import { createAvatar } from '@dicebear/core';
import { notionists } from '@dicebear/collection';
import { writeFileSync } from 'node:fs';
const team = { aria: ['Aria-haven', '8b5cf6'], nova: ['Nova-triage', '22d3ee'], rex: ['Rex-forensics', 'f97316'], mira: ['Mira-care', 'f472b6'], kai: ['Kai-secops', '10b981'], iris: ['Iris-data', 'facc15'], juno: ['Juno-policy', '60a5fa'], leo: ['Leo-growth', 'a3e635'] };
const out = process.argv[2];
for (const [id, [seed, color]] of Object.entries(team)) {
  const svg = createAvatar(notionists, { seed, backgroundColor: ['1c2135'], scale: 110, radius: 50 }).toString();
  writeFileSync(`${out}/${id}.svg`, svg);
}
console.log('avatars written');
