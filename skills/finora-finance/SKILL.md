---
name: finora-finance
description: Use Finora from an AI agent to securely connect an account, import and analyze bank/credit-card/UPI statements, categorize transactions, normalize merchants, find subscriptions/duplicates/anomalies, answer ledger-grounded finance questions, create reports, and sync Google Sheets. Trigger for `/finance`, `skill-sync`, statement files, spending questions, merchant searches, budgets, trends, reports, or Sheets actions. Do not use for investment, tax, or legal advice.
---

# Finora Finance

Use Finora's authenticated backend as the source of truth. Do not recreate totals, categorization, or anomaly logic in the agent when a Finora action exists.

## Start or reconnect

Run:

```bash
node <skill-directory>/scripts/finora.mjs skill-sync
```

If it returns `authentication_required`, show the verification URL to the user as a clickable link and tell them to approve it with Google. Never paste or display the device code, access token, or contents of the credentials file. After the user says approval is complete, run `skill-sync` again. The script stores the account token locally and requests authentication again only after expiry, revocation, or an explicit logout.

If no server is configured, run `node <skill-directory>/scripts/finora.mjs configure https://YOUR-FINORA-DOMAIN` using the deployment URL supplied by the user or installer. For local development the default is `http://localhost:3001`.

## Route requests

Use the smallest matching backend action. Read [references/api.md](references/api.md) when an action's payload is unclear.

- Statement attachment or import: `upload <path>`. Ask whether to append or replace only when replacing an existing ledger is material.
- General finance question or follow-up: `ask "<question>"`.
- Account/ledger readiness: `skill-sync`.
- Totals or category breakdown: `call summary`.
- Monthly history or trend: `call monthly_summary`.
- Period comparison: `call compare_months current=YYYY-MM previous=YYYY-MM`.
- Merchant/category/date search: `call search_transactions query=Amazon`.
- User category correction: `call correct_category transactionId=... category=Travel`.
- Budget changes: put the payload in a temporary JSON file and run `call set_budgets @payload.json`.
- Recurring charges: `call detect_subscriptions`.
- Possible duplicates: `call find_duplicates`.
- Unusual activity: `call detect_anomalies`.
- Budgets or health score: `call budget_status` or `call financial_health_score`.
- Google Sheets: `call sheet_status`, then `call sync_sheets`. If Google permission is required, present the returned `actionUrl` and retry after the user connects it.
- Weekly/monthly email: `call report_settings '{"enabled":true,"frequency":"weekly","timezone":"Asia/Kolkata"}'`. This is a write and requires confirmation.

## Judgment and safety

- Treat parsing, imports, ledger replacement, report changes, and Sheets sync as writes. Confirm before a destructive replacement, deletion, sharing, or scheduled email change. An explicit user request to do the action counts as confirmation.
- Include person-to-person transfers and investments by default. Label and subtotal them separately; exclude them only if the user explicitly asks.
- Preserve uncertainty and confidence. Describe duplicates and anomalies as possible findings, not facts.
- Keep answers concise and ledger-grounded. Use the backend's answer verbatim when it is already clear; otherwise summarize without changing numbers.
- Never expose authentication material, Google OAuth tokens, raw API payload secrets, or the local credential file.
- Do not give investment, tax, legal, or credit advice. Provide factual ledger analysis and suggest a qualified professional for high-stakes decisions.

## Agent invocation

- Codex: `$finora-finance skill-sync` or mention Finora naturally.
- Claude command alias: `/finance skill-sync` when `commands/finance.md` is installed.
- Other Agent Skills-compatible clients: invoke `finora-finance` naturally or execute the bundled client commands.
