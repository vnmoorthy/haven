# Third-Party Community Bot Policy

**Owner:** Juno (Policy & Product) · **Enforced by:** Kai (Security Engineer) · **Engine:** Prelint spec check

Every third-party bot, plugin or integration that a Haven-protected community wants to install is audited
against this spec before it is allowed in. The audit runs a Snyk dependency + code scan, a Tenki sandbox
install-and-test run, and a Prelint spec check of the bot's manifest and source against the rules below.

Rule IDs are stable. Prelint cites them in PR reviews and Haven cites them in audit reports. Never renumber;
deprecate instead.

Keywords **MUST**, **MUST NOT**, **SHOULD** follow RFC 2119. A MUST violation fails the rule; a SHOULD
violation is a warning.

## Rules

### BOT-001 Bots MUST NOT request ADMINISTRATOR
A bot MUST NOT request the `ADMINISTRATOR` permission (or any equivalent "all permissions" flag). Bots MUST
request the smallest permission set that serves their stated purpose. Requesting `MANAGE_GUILD`,
`BAN_MEMBERS`, `KICK_MEMBERS`, `MANAGE_ROLES`, `MANAGE_WEBHOOKS` or `MENTION_EVERYONE` SHOULD be justified
in the manifest.

- **Check:** `bot.manifest.json` → `permissions[]`; source references to administrator permission flags.
- **Severity:** critical

### BOT-002 MESSAGE_CONTENT intent requires a stated purpose
A bot that requests the privileged `MESSAGE_CONTENT` intent (or `GUILD_MEMBERS` / `GUILD_PRESENCES`) MUST
state why in `intentPurpose.<INTENT>`. Bots that only respond to slash commands do not need message content.

- **Check:** `bot.manifest.json` → `intents[]` and `intentPurpose{}`.
- **Severity:** high

### BOT-003 No eval/exec of user content
A bot MUST NOT evaluate or execute user-supplied content: no `eval()`, `new Function()`, `vm.runIn*`,
`child_process.exec*` / `spawn` with interpolated input, Python `eval`/`exec`/`os.system`, or
`subprocess(..., shell=True)`.

- **Check:** static scan of source files.
- **Severity:** critical

### BOT-004 Secrets must never be hardcoded or logged
Tokens, API keys, signing secrets and passwords MUST come from the environment or a secret manager. They
MUST NOT appear as string literals in source and MUST NOT be written to logs, telemetry or URLs.

- **Check:** static scan for secret-shaped literals, bot-token formats, and log/telemetry calls that include
  token/secret identifiers.
- **Severity:** critical

### BOT-005 Webhooks only to allow-listed HTTPS domains
Outbound webhooks and telemetry MUST use `https://` and MUST target a domain on the community's allow-list
(default allow-list: `discord.com`, `discordapp.com`, `slack.com`, `hooks.slack.com`, `github.com`,
`api.github.com`, `haven.dev`). Plain `http://` endpoints and raw IP addresses are never allowed.

- **Check:** `bot.manifest.json` → `webhooks[]`, `telemetry`; `http://` URLs in source.
- **Severity:** high

### BOT-006 Data retention <= 30 days
A bot MUST declare `dataRetention` and it MUST be 30 days or less. `"forever"`, `"indefinite"` or a missing
value fails. Bots that collect `direct_messages` or `ip_addresses` SHOULD NOT be installed.

- **Check:** `bot.manifest.json` → `dataRetention`, `dataCollected[]`.
- **Severity:** high

### BOT-007 Dependencies must have no critical/high vulns
The bot's dependency tree MUST have zero known critical or high severity vulnerabilities (Snyk, falling back
to OSV.dev). Medium/low findings are warnings.

- **Check:** Snyk `test --json` results.
- **Severity:** high

### BOT-008 Tests must pass in sandbox
The bot MUST ship a test suite and it MUST pass when installed with `--ignore-scripts` and run in an isolated
sandbox (Tenki) with no secrets in the environment.

- **Check:** Tenki sandbox `npm install --ignore-scripts && npm test` exit code.
- **Severity:** medium

### BOT-009 Publisher must be identifiable
A bot SHOULD name an identifiable publisher, an `https://` homepage and a privacy policy.

- **Check:** `bot.manifest.json` → `author`, `homepage`, `privacyPolicy`.
- **Severity:** low

## Grading

Kai turns the results into a 0–100 score: critical vuln −25, high −12, medium −4, low −1 (vuln penalty
capped at −60), each failed rule −10, each warning −3, failing tests −10. Grades: **A** ≥ 90, **B** ≥ 75,
**C** ≥ 60, **D** ≥ 40, **F** < 40. Grades D and F are blocked from install; C requires a human moderator's
approval.
