# Installation

Install globally for supported agents with the Skills CLI:

```bash
npx skills add AdarshSingh-ASR/Finora --skill finora-finance --global --yes
```

The client is preconfigured for `https://finora.finora-asr.workers.dev`. Restart the agent if it does not discover the new skill immediately.

For the downloaded ZIP, extract it and run `node scripts/install.mjs`. The fallback installer writes the production endpoint and copies the package to `~/.codex/skills/finora-finance`, `~/.agents/skills/finora-finance`, and the Claude command directory. Pass another server URL only for a self-hosted deployment.

Invocation:

- Codex: `$finora-finance skill-sync`
- Claude: `/finance skill-sync`
- Natural language: “Use Finora to compare this month with last month.”

The first sync returns a browser verification link. Google sign-in and consent happen only on the Finora domain; the client persists the resulting Finora token in `~/.finora/agent-skill.json` with owner-only permissions where supported.
