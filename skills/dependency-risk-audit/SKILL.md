---
name: Dependency Risk Audit
description: Audit a third-party community bot before install — dependencies, code, permissions and tests — and issue an A-F grade with fixes.
owner: kai
version: 1.0.0
tags: [security, supply-chain, snyk, sandbox, bot-audit]
---

# Dependency Risk Audit

## When to use
- A community admin wants to install a new bot or integration.
- An installed bot ships a new version.
- A CVE drops for a dependency used by any installed bot.

## Instructions
1. Fetch the bot source (bundled sample or public GitHub URL) into an isolated sandbox. Never execute it on a Haven host.
2. Run Snyk Open Source on the manifest/lockfile; record every vulnerability with id (CVE/GHSA/SNYK), severity, package@version, fixed-in version and whether it is reachable.
3. Run Snyk Code (SAST) on the source; flag hard-coded secrets, eval / child_process with user input, SSRF, path traversal, insecure deserialization and token logging.
4. Check hygiene: unpinned or wildcard versions, install scripts (postinstall), abandoned packages, typosquat-looking names, overly broad file globs.
5. Execute the bot's test suite in a Tenki sandbox runner with no network egress except the package registry; record pass/fail counts and any test that tries to reach the network.
6. Validate requested permissions against the Prelint product spec: the bot must request only the scopes its declared features need (e.g. no Administrator, no read-all-DMs for a welcome bot).
7. Grade: A (no high/critical, least privilege, tests pass), B (mediums only), C (one high or excess scopes), D (critical or secrets), F (malicious behaviour, exfiltration, or tests attempt network calls to unknown hosts).
8. Always give concrete fixes: exact upgrade versions, scopes to remove, lines to change.

## Output format
```json
{ "grade": "A-F", "score": 0, "critical": 0, "high": 0, "medium": 0, "low": 0,
  "findings": [{ "id": "...", "severity": "high", "package": "x@1.2.3", "fix": "upgrade to 1.2.9" }],
  "permissions": { "requested": [], "excess": [] }, "tests": { "passed": 0, "failed": 0 },
  "verdict": "install|install-with-fixes|block" }
```
Plus a 3-bullet executive summary for the founder.
