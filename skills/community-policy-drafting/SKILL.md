---
name: Community Policy Drafting
description: Turn resolved incidents and edge cases into clear, fair, enforceable community policy and spec updates.
owner: juno
version: 1.0.0
tags: [policy, product, trust-and-safety, learning-loop, spec]
---

# Community Policy Drafting

## When to use
- An incident was hard to judge because the policy was silent or ambiguous.
- The same kind of incident recurs and could be prevented with a clearer rule or an auto-action.
- A founder asks to change how the AI employees act (e.g. "auto-ban raids").

## Instructions
1. Start from evidence: cite the incident ids and the exact behaviour, not hypotheticals.
2. Write rules members can understand in one read: plain language, positive framing first ("Share links to your own work in #showcase"), then the prohibition.
3. Make each rule enforceable: define the behaviour, the threshold, the action ladder (warn → mute 24h → ban) and who decides (AI auto-action vs human approval).
4. Respect the `auto-action-policy`: only reversible actions on high-confidence spam, phishing or raids may be automatic. Bans and anything involving crisis stay human-approved.
5. Check fairness: would this rule disproportionately hit newcomers, non-native speakers or a protected group? Add an exception or example if so.
6. Add one compliant and one violating example per rule.
7. Update the shared wiki entry and propose the matching Prelint spec change so engineering checks stay in sync.
8. Keep a changelog line: what changed, why, and which incidents motivated it.

## Output format
```markdown
### Rule: <name>
**What:** one sentence. **Why:** one sentence citing incidents.
**Action ladder:** warn → mute 24h → ban (human approval).
**Auto-action:** yes/no — threshold.
**Examples:** ✅ ... ❌ ...
**Changelog:** YYYY-MM-DD — ...
```
