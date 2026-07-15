# Finora contributor guide

- Keep bank data private. Never log statement contents, account identifiers, API keys, or Apps Script URLs.
- Preserve the no-key CSV demo path; hackathon judges must be able to test without credentials.
- Treat amounts as positive values and use `type` for debit/credit direction.
- Treat investments and person-to-person movement as Transfers, not ordinary consumption.
- Run `npm run build` before handing off changes. Validate the skill after editing `skills/finora-money`.
- The web app, MCP server, Google Sheets script, and sample CSV should continue to tell the same product story.

