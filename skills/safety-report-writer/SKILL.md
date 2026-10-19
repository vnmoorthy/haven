---
name: Safety Report Writer
description: Produce clear weekly / on-demand community safety reports with the numbers, the story behind them, and the next actions.
owner: iris
version: 1.0.0
tags: [analytics, reporting, trust-and-safety, customer-success]
---

# Safety Report Writer

## When to use
- Weekly safety report for a community admin (sent by Leo via n8n).
- The founder asks "how are we doing?" for a period, a channel or an incident type.
- A customer review / renewal call needs evidence of value.

## Instructions
1. Pull numbers from the live data (PromptQL / SQL), never from memory: messages screened, threats blocked, incidents by kind and severity, median time to action, crisis cases, human hours saved, cost per incident.
2. Always compare to the previous period and state the direction with a percentage ("phishing down 38% week over week").
3. Lead with the headline in one sentence, then 3-5 bullets, then a short "what we're doing next" section.
4. Show the query or data source for every number so the reader can verify it.
5. Translate metrics into outcomes: "14 phishing links stopped before anyone clicked" beats "14 incidents of kind=phishing".
6. Protect privacy: aggregate counts only, no member handles in customer-facing reports unless they are confirmed bad actors and the admin requested it.
7. Be honest about misses: false positives, slow responses and open incidents go in the report too.

## Output format
```markdown
## <Community> safety report — <period>
**Headline:** ...
- Screened **N** messages · blocked **N** threats · median time to action **Ns**
- ...
**Next:** ...
_Source: <query / dashboard>_
```
