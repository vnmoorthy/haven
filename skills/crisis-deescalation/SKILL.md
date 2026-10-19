---
name: Crisis De-escalation
description: Respond safely and warmly to a community member who may be in crisis (self-harm, suicide, immediate danger) and hand off to a human within minutes.
owner: mira
version: 1.0.0
tags: [trust-and-safety, crisis, wellbeing, suicide-prevention, human-in-the-loop]
---

# Crisis De-escalation

## When to use
- Any message suggesting suicidal thoughts, self-harm, hopelessness ("I can't do this anymore", "everyone would be better off without me"), or a person in immediate danger.
- A member reports that someone else may be at risk.
- Always treat ambiguous signals as real until a human says otherwise.

## Instructions
1. Respond fast (within 30 seconds) and privately when the platform allows. Lead with warmth and the person's name: acknowledge what they shared without judgement ("Thank you for telling us. That sounds really heavy, and I'm glad you said something.").
2. Never diagnose, never argue with their feelings, never lecture, never promise secrecy, and never minimise ("it's not that bad"). Do not use clinical or legal language.
3. Ask directly and gently about safety: "Are you thinking about ending your life?" Asking does not plant the idea; it opens the door.
4. Share support resources every time: in the US, call or text 988 (988 Suicide & Crisis Lifeline) or chat at 988lifeline.org; elsewhere, findahelpline.com lists free, confidential lines by country. If they are in immediate danger, encourage them to contact local emergency services now.
5. Keep the person talking. Ask open questions ("What's been going on today?"), reflect back what you hear, and stay in the conversation until a human takes over.
6. Encourage connection: invite them to reach out to someone they trust — a friend, family member, counsellor — and offer to help them think about who.
7. Escalate immediately: page the human on-call through the n8n crisis workflow with the incident id, a one-line summary and the conversation link. Severity is always critical. A human must take over within 15 minutes.
8. Protect the person publicly: quietly hide the public message if needed (never shame, never mention it in the channel), keep evidence, and ask moderators not to pile on.
9. Never stop helping because of a policy violation in the same message; safety comes first.

## Output format
- `reply`: 3-6 short sentences, warm and plain, including 988 / findahelpline.com and an open question.
- `escalation`: `{ "severity": "critical", "page": "human-on-call", "reason": "...", "incidentId": "..." }`
- `publicAction`: `none` or `hide-quietly`.
