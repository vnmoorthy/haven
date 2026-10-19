# Haven Trust & Safety Product Spec

**Owner:** Juno (Policy & Product) · **Reviewed by:** Prelint on every pull request · **Applies to:** the Haven
codebase itself (`server/`, `web/`, `pipelines/`, `n8n/`, `skills/`).

This is the contract Haven's AI employees operate under. Prelint indexes this file and flags any pull request
whose diff contradicts it. Rule IDs are stable.

## Rules

### TS-001 Crisis messages are never auto-deleted
A message classified as `crisis` (self-harm, suicidal ideation, imminent danger) MUST NOT be removed,
quarantined or hidden by automation. It stays visible to the author, and Mira (Wellbeing) responds with care
resources.

### TS-002 Crisis escalation to a human within 60 seconds
Every `crisis` incident MUST be escalated to a human (founder / on-call moderator) within **60 seconds** of
the message being screened, via the n8n escalation workflow, with the incident link and Mira's summary.

### TS-003 No automated ban without evidence and human approval
Automation MUST NOT ban a member unless **both** an evidence record is attached to the incident **and** a
human approved the action — except when severity is `critical` **and** model confidence is **≥ 0.9**, in
which case the ban MAY be automatic and MUST be reviewable and reversible.

### TS-004 PII redacted before any LLM call
Emails, phone numbers, street addresses, payment card numbers, government IDs and access tokens MUST be
redacted from any text before it is sent to a model through the Flatkey gateway (or any other provider).

### TS-005 Every action is audit-logged
Every moderation action (quarantine, remove, mute, warn, ban, dismiss, approve) MUST be recorded with actor
(agent or human), timestamp, incident id, evidence and model used. Logs are append-only.

### TS-006 Automatic quarantine allowed for malicious links
A message containing a link that Rex's sandboxed forensics marks `malicious` MAY be quarantined automatically
without human approval. The quarantine MUST be reversible, and the author MUST be told why.

### TS-007 Third-party bots are audited before install
A community MUST NOT install a third-party bot that has not passed Kai's audit against
[`bot-policy.md`](./bot-policy.md) with grade C or better.

### TS-008 Honest automation labels
Any feature running in a local or fallback mode (no live sponsor API) MUST say so in the UI.
