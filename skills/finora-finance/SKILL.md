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

Prefer the highest-level outcome action that matches the user's goal. Use low-level ledger or spreadsheet actions only for explicit row, range, correction, or workbook-management requests. Read [references/api.md](references/api.md) when an action's payload is unclear.

- End-to-end statement workflow: `upload <path>` for the interactive client, or `call sync_statement @payload.json` when parse, normalize, categorize, review, save, and optional Sheets sync should be coordinated. Ask before destructive ledger replacement.
- General finance question or follow-up: `ask "<question>"`; use `call answer_finance_question question="..."` when a structured API result is needed.
- Account/ledger readiness: `skill-sync`.
- Full period analysis: `call analyze_finances period=YYYY-MM`.
- Visual report/dashboard: `call generate_dashboard period=YYYY-MM`. Add `syncSheets=true` only when the user asks to update Google Sheets.
- Six-month narrative: `call financial_timeline months=6`.
- Savings opportunities or realistic reductions: `call find_savings` or `call find_cost_cutting`.
- Explain a change: `call explain_spending_change current=YYYY-MM previous=YYYY-MM`.
- Forecast the current month: `call predict_month_end_spending period=YYYY-MM`.
- Financial health: `call financial_health_report period=YYYY-MM`.
- Budget recommendation or overrun explanation: `call suggest_budget` or `call why_is_budget_exceeded category="Food & Dining" period=YYYY-MM`.
- Totals or category breakdown: `call summary`.
- Monthly history or trend: `call monthly_summary`.
- Period comparison: `call compare_months current=YYYY-MM previous=YYYY-MM`.
- Merchant/category/date search: `call search_transactions query=Amazon`.
- User category correction: `call correct_category transactionId=... category=Travel`.
- Add or remove confirmed rows: `call add_transaction @payload.json` or `call delete_transactions @payload.json`. Require confirmation before deletion.
- Budget changes: put the payload in a temporary JSON file and run `call set_budgets @payload.json`.
- Remove one budget with `call remove_budget category=Shopping`.
- Recurring charges: `call detect_subscriptions`.
- Possible duplicates: `call find_duplicates`.
- Unusual activity: `call detect_anomalies`.
- Budgets or health score: `call budget_status` or `call financial_health_score`.
- Google Sheets: `call sheet_status`, then `call sync_sheets`. Use `call sheet_inspect` to verify tabs, chart counts, and sample rows. Read [references/api.md](references/api.md) before tab/range edits. If Google permission is required, present the returned `actionUrl` and retry after the user connects it.
- Weekly/monthly email: `call report_settings '{"enabled":true,"frequency":"weekly","timezone":"Asia/Kolkata"}'`. This is a write and requires confirmation.
- Rich monthly review: `call monthly_report period=YYYY-MM`. Reset email preferences with `call report_settings_clear` only when requested.

## Judgment and safety

- Treat parsing, imports, ledger replacement, report changes, and Sheets sync as writes. Confirm before a destructive replacement, tab/range deletion, workbook deletion, sharing, or scheduled email change. An explicit user request to do the action counts as confirmation.
- Include person-to-person transfers and investments by default. Label and subtotal them separately; exclude them only if the user explicitly asks.
- Preserve uncertainty and confidence. Describe duplicates and anomalies as possible findings, not facts.
- Lead with the direct answer. Add supporting merchants, categories, comparisons, anomalies, forecast or budget implications only when they materially help. Use returned bar, line, donut, table, or timeline data instead of inventing a visualization. Use a trusted Finora HTML report for a financial review or dashboard, never model-authored arbitrary HTML.
- Offer two to four contextual next questions after a rich analysis. Do not turn a simple lookup into a long report.
- Never expose authentication material, Google OAuth tokens, raw API payload secrets, or the local credential file.
- Do not give investment, tax, legal, or credit advice. Provide factual ledger analysis and suggest a qualified professional for high-stakes decisions.

## Agent invocation

- Codex: `$finora-finance skill-sync` or mention Finora naturally.
- Claude command alias: `/finance skill-sync` when `commands/finance.md` is installed.
- Other Agent Skills-compatible clients: invoke `finora-finance` naturally or execute the bundled client commands.
