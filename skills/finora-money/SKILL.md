---
name: finora-money
description: Import, normalize, analyze, correct, and sync personal bank, credit-card, and UPI statements through the Finora MCP server. Use when the user asks where their money went, requests a spending summary, wants recurring charges or unusual transactions found, needs transaction categories corrected, or wants a Finora ledger sent to Google Sheets.
---

# Finora money

Use the `finora` MCP tools as the source of truth. Never infer transaction facts when a tool can retrieve them.

## Workflow

1. For a new statement, call `import_statement` with its path. Set `replace: true` only when the user explicitly wants a fresh ledger.
2. Call `get_spending_summary` before answering broad questions about spend, savings, or category totals.
3. Call `list_transactions` for merchant-, category-, or evidence-level questions. Mention low-confidence classifications when they affect the answer.
4. Call `correct_category` only after the user gives or confirms a correction.
5. Call `sync_to_google_sheets` only when the user asks to sync and provides their Apps Script web app URL.

## Answer style

- Lead with the decision-useful answer, then the evidence.
- Format money in the ledger currency.
- Separate consumption from Transfers; do not describe investments or person-to-person transfers as ordinary spending.
- State the statement period and transaction count when scope may be ambiguous.
- Do not provide investment, tax, or legal advice. Frame projections as estimates.
- Protect privacy: do not echo full account numbers, UPI IDs, or raw statement narrations unless needed.

Read [references/categories.md](references/categories.md) only when category boundaries or correction policy matter.

