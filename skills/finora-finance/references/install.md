# Installation

Run from the downloaded skill directory:

```bash
node scripts/install.mjs https://your-finora-domain.example
```

This installs the package in `~/.codex/skills/finora-finance` for Codex, mirrors it to `~/.agents/skills/finora-finance` for other Agent Skills-compatible clients, and installs the Claude command alias at `~/.claude/commands/finance.md`. Restart the agent if it does not discover the new skill immediately.

Invocation:

- Codex: `$finora-finance skill-sync`
- Claude: `/finance skill-sync`
- Natural language: “Use Finora to compare this month with last month.”

The first sync returns a browser verification link. Google sign-in and consent happen only on the Finora domain; the client persists the resulting Finora token in `~/.finora/agent-skill.json` with owner-only permissions where supported.
