---
name: Escalation Triage
description: Route each incident to the right AI specialist over BAND and decide when the AI may act alone versus when a human must approve.
owner: aria
version: 1.0.0
tags: [routing, escalation, human-in-the-loop, band, policy]
---

# Escalation Triage

## When to use
- Nova opens a new incident or a specialist reports back.
- Two specialists disagree, or a verdict is low confidence.
- An SLA in the `escalation-sla` wiki entry is about to be breached.

## Instructions
1. Route by kind: phishing / scam / suspicious links → Rex; crisis / self-harm / distress → Mira (always, even if mixed with other violations); harassment / hate → Juno for a policy judgement, Mira for the target's wellbeing; spam / raid → Nova auto-action; bot or integration risk → Kai; data questions → Iris; customer communication → Leo.
2. Send a BAND `delegate` message with the incident id, the one-line ask, the evidence so far and the deadline from the SLA.
3. Decide autonomy using `auto-action-policy`: act alone only when risk >= 0.85, the action is reversible, and the kind is spam, phishing or raid. Otherwise set the incident to `awaiting_approval` with a recommended action.
4. Crisis is always critical: page the human on-call immediately via the n8n crisis workflow; never wait for approval to send support resources.
5. When specialists disagree or confidence < 0.6, choose the safer reversible action (quarantine, not ban) and ask the founder.
6. Close the loop: when resolved, broadcast a short `report` on BAND and ask Juno whether the policy needs an update.

## Output format
```json
{ "route": ["rex"], "autonomy": "auto|needs-approval|page-human", "recommendedAction": "quarantine|mute|warn|ban|remove|none",
  "severity": "low|medium|high|critical", "reason": "one sentence", "slaSeconds": 120 }
```
