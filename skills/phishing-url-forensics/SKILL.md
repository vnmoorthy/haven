---
name: Phishing URL Forensics
description: Detonate a suspicious link inside an isolated computer, collect evidence, and return a defensible phishing verdict with a 0-1 risk score.
owner: rex
version: 1.0.0
tags: [trust-and-safety, phishing, forensics, browser-automation, threat-intel]
---

# Phishing URL Forensics

## When to use
- A community message contains a URL that Nova scored above 0.4, or that matches a look-alike / shortener pattern.
- A member reports "is this link safe?" or a moderator asks for a second opinion.
- A domain needs to be added to (or removed from) the shared blocklist.

## Instructions
1. Never open the link on a Haven host. Detonate it only inside an isolated sandbox computer (Celesto) driven by a browser agent (AdaL); fall back to the local headless sandbox only if Celesto is unavailable, and say so in the report.
2. Before visiting, parse the URL: host, registrable domain, TLD, path, query. Check it against the shared blocklist wiki entry `blocklist-domains` and against brand look-alikes (homoglyphs like 0/o, 1/l, rn/m; brand + "-verify", "-secure", "-auth", "-login"; risky TLDs such as .top, .xyz, .gift, .ru, .click).
3. Visit with a fresh profile, no stored cookies, downloads disabled. Follow redirects (max 10) and record every hop.
4. Capture evidence: final URL, page title, a full-page screenshot, every form (action, method, whether it has a password / seed-phrase / 2FA / card field, whether it posts to a different domain), and any obfuscated or auto-submitting script.
5. Score with explicit, weighted signals (look-alike domain, credential form, external form action, urgency language, brand impersonation, redirect chain through shorteners, very new domain). Each signal must name the evidence it came from.
6. Verdict: malicious (score >= 0.75 or a credential form on a look-alike domain), suspicious (0.4-0.74), benign (< 0.4 with no credential capture), unreachable (DNS / TLS / timeout — never call an unreachable link safe).
7. If malicious: recommend quarantine of the message, add the registrable domain to the shared blocklist, and report back to Aria over BAND with the incident id.
8. Never submit real data into a suspected phishing form. Never click "allow notifications", download files, or connect wallets.

## Output format
```json
{ "url": "...", "finalUrl": "...", "redirects": ["..."], "verdict": "malicious|suspicious|benign|unreachable",
  "score": 0.0, "signals": [{ "id": "lookalike-domain", "label": "...", "weight": 0.35, "detail": "..." }],
  "recommendedAction": "quarantine|warn|none", "blocklist": ["domain.tld"], "evidence": { "screenshot": "...", "forms": [] } }
```
Followed by a two-sentence plain-English explanation a moderator can paste into the incident.
