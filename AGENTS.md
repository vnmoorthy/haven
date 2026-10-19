# AGENTS.md — rules for AI reviewers (Tenki Reviewer, Prelint, coding agents)

Haven is an AI-native Trust & Safety company. Any change to this repo must keep these product rules true
(full specs live in `specs/`, which Prelint indexes):

1. **Crisis first.** Messages classified as `crisis` are never removed, hidden or auto-closed. Mira must reply and a human must be paged (n8n `crisis-escalation`) — see `specs/trust-and-safety-policy.md`.
2. **Humans approve bans.** No automated ban/mute of a real member without `requestApproval()` → founder decision, except the documented auto-actions (spam removal, raid quarantine, malicious-link quarantine).
3. **Evidence before action.** Every incident stores triage scores, forensic evidence and the BAND thread that led to the decision.
4. **PII stays home.** Message text is redacted by the RocketRide `anonymize_text` stage before it reaches a third-party model.
5. **Never execute untrusted code outside a sandbox.** Bot audits run installs with `--ignore-scripts` inside Tenki (or the local sandbox runner) — never in the server process.
6. **Every model call goes through Flatkey** (`server/src/integrations/flatkey.ts`) so cost and failover are tracked.
7. Secrets only via environment variables; never commit `.env`.
