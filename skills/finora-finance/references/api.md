# Finora agent API

The bundled client calls `POST /api/agent` with a bearer token and `{ "action": "..." }`. Prefer the client script so secrets remain out of the conversation.

## Read actions

| Action | Optional fields | Result |
| --- | --- | --- |
| `skill_sync` | none | Connection, ledger periods, Sheets and report state |
| `summary` | none | Income, consumption, transfers/investments, savings and categories |
| `monthly_summary` / `spending_trends` | none | Monthly time series |
| `compare_months` | `current`, `previous` (`YYYY-MM`) | Period and category changes |
| `search_transactions` | `query` | Matching merchant, narration, category or date rows |
| `merchant_analysis` | `merchant` | Merchant rows, count and total |
| `detect_subscriptions` | none | Recurring merchants, cadence, renewal and confidence |
| `find_duplicates` | none | Possible duplicate pairs |
| `detect_anomalies` | none | Unusual category or merchant activity |
| `budget_status` | `period` | Budget usage |
| `financial_health_score` | none | Evidence-based score and breakdown |
| `weekly_report` | none | Weekly totals, leaders and suggestion |
| `answer_finance_question` | `question`, optional `history` | Natural-language answer grounded in the ledger |
| `sheet_status` | none | Connected spreadsheet and staleness |
| `list_transactions` / `categorize_transactions` | none | Canonical categorized ledger rows |

## Write actions

- `import_statement`: `filename`, `mimeType`, and either `text` or a base64 `fileData`; optional `replace`.
- `save_ledger`: full canonical `statement` and optional `budgets`.
- `correct_category`: `transactionId` and the confirmed `category`.
- `set_budgets`: a `budgets` array of category/limit pairs.
- `sync_sheets`: creates Finora Financial Dashboard when absent, otherwise updates the connected workbook; optional `name` on creation.
- `sheet_connect`, `sheet_rename`, `sheet_copy`, `sheet_move`, `sheet_share`, and `sheet_disconnect` provide focused workbook management actions.
- `report_settings`: `enabled`, `frequency` (`weekly` or `monthly`), and `timezone`.

Google Sheets and Gmail scopes are granted only in Finora's browser UI. When an action returns `actionRequired` and `actionUrl`, open that URL, approve the additional Google scope, then retry.
