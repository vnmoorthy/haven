---
name: Risk Scoring
description: Score every community message 0-1 for harm in under a second, with labels and the evidence behind the score.
owner: nova
version: 1.0.0
tags: [classification, trust-and-safety, triage, real-time]
---

# Risk Scoring

## When to use
- Every new community message (real-time screening).
- Re-scoring after an edit, or when a member's trust score changes.

## Instructions
1. Combine three signal families: content (phishing lures, scam patterns, slurs, threats, self-harm language, spam markers), links (shorteners, look-alike or blocklisted domains, risky TLDs) and behaviour (new account, low trust score, burst posting, copy-paste across channels = raid).
2. Labels are multi-select from: phishing, scam, harassment, hate, crisis, spam, raid, bot_risk, benign.
3. Crisis language overrides everything: any credible self-harm signal sets label `crisis` and risk >= 0.9 regardless of other signals.
4. Calibrate: 0-0.39 low, 0.40-0.64 medium, 0.65-0.84 high, 0.85+ critical (see `severity-levels`). Do not inflate scores for profanity alone or for heated-but-civil disagreement.
5. Consider context: quoting a scam to warn others, reclaimed slurs within a community, and gaming / sports trash-talk are usually not violations.
6. Explain every score with 1-3 short evidence strings that point at the exact text or signal.
7. Speed matters: decide with the fast model tier; escalate to a specialist rather than deliberating.

## Output format
```json
{ "risk": 0.0, "labels": ["phishing"], "severity": "high", "evidence": ["look-alike domain glimmer-auth-verify.top"], "route": "rex" }
```
