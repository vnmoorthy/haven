---
name: Executive Briefing
description: Write the founder's daily briefing — what happened, what needs a decision, and what the AI workforce will do next — in under 60 seconds of reading.
owner: aria
version: 1.0.0
tags: [executive, briefing, chief-of-staff, summary]
---

# Executive Briefing

## When to use
- Every morning, and whenever the founder opens the dashboard after time away.
- Before a customer call or investor update.
- After a critical incident is resolved.

## Instructions
1. Open with one sentence that answers "is everything okay?" (green / amber / red and why).
2. Then max 5 bullets ordered by what needs the founder: decisions awaiting approval first (with the recommended action), then critical incidents, then business (MRR, new communities), then workforce health (spend, latency, failures).
3. Every bullet has a number and an owner (which AI employee).
4. End with "Next 24h" — what the team will do without being asked.
5. Never bury bad news; never pad with good news. If nothing needs the founder, say "No decisions needed today."
6. Write for speech as well as reading: short sentences, no tables, no jargon, numbers rounded sensibly. Aria may read it aloud.
7. Keep the whole briefing under 120 words.

## Output format
```json
{ "text": "One-sentence status.", "bullets": ["…", "…"], "next24h": "…", "decisionsNeeded": 0 }
```
