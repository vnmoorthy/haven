# Haven on Kylon

Haven's eight AI employees can run as real teammates in a [Kylon](https://docs.kylon.io) workspace, next to the human founder.

| File | What it is |
|---|---|
| `workforce.yaml` | Team manifest: founder + 8 employees (title, team, specialty, bio, persona, `reports_to`, responsibilities, sponsor tools, Flatkey model tier, Finch skills, KPI, visibility). Generated from `server/src/agents/roster.ts`. |
| `agents.json` | The exact agent specs `kylon workspace agent create --agents-json` accepts (`name`, `specialty`, `bio`, `persona`, `visibility`, `proposal_reason`). |

## Sync the workforce

Kylon creates 1 to 3 agents per call, so the 8 employees go in three batches.

```bash
# 1. Install the Kylon CLI and sign in (see https://docs.kylon.io)
kylon login

# 2. Pick the workspace
export KYLON_WORKSPACE_ID=<your_workspace_id>

# 3. Create the employees in batches of up to 3
kylon workspace agent create --scope-workspace "$KYLON_WORKSPACE_ID" --json \
  --agents-json "$(node -e 'console.log(JSON.stringify(require("./kylon/agents.json").slice(0,3)))')"
kylon workspace agent create --scope-workspace "$KYLON_WORKSPACE_ID" --json \
  --agents-json "$(node -e 'console.log(JSON.stringify(require("./kylon/agents.json").slice(3,6)))')"
kylon workspace agent create --scope-workspace "$KYLON_WORKSPACE_ID" --json \
  --agents-json "$(node -e 'console.log(JSON.stringify(require("./kylon/agents.json").slice(6,8)))')"

# 4. Check them
kylon workspace agent directory --scope-workspace "$KYLON_WORKSPACE_ID" --query haven
```

Or let the server run the same batches: set `KYLON_WORKSPACE_ID`, keep `kylon` on your `PATH`, then click **Sync to Kylon** on the Integrations page. That button calls `syncToKylon()` in `server/src/integrations/kylon.ts`.

## Regenerate after editing the roster

```bash
cd server && npx tsx -e "import('./src/integrations/kylon.ts').then(m => console.log(m.writeKylonFiles()))"
```

All agents are created with `visibility: private`. Bans, legal reports and crisis hand-offs are always approved by the human founder, as `founder.approves` in `workforce.yaml` states.
