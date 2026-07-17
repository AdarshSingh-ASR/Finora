# Finora agent API

The bundled client calls `POST /api/agent` with a bearer token and `{ "action": "..." }`. Prefer the client script so secrets remain out of the conversation.

Pass simple payloads as cross-platform `key=value` arguments, for example `call search_transactions query=Amazon`. For nested objects or arrays, write JSON to a temporary file and pass `@payload.json`. Inline JSON remains supported where shell quoting preserves it.

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
| `monthly_report` | optional `period` | Monthly summary, comparison, subscriptions, anomalies, and health |
| `answer_finance_question` | `question`, optional `history` | Natural-language answer grounded in the ledger |
| `sheet_status` | none | Connected spreadsheet and staleness |
| `sheet_inspect` | none | Workbook title, tabs, dimensions, chart counts, and bounded sample rows |
| `list_transactions` / `categorize_transactions` | none | Canonical categorized ledger rows |

## Write actions

- `import_statement`: `filename`, `mimeType`, and either `text` or a base64 `fileData`; optional `replace`.
- `save_ledger`: full canonical `statement` and optional `budgets`.
- `add_transaction`: `date`, `merchant`, `amount`, `type`/`direction`, `category`, optional `description`.
- `delete_transactions`: a confirmed `transactionIds` array.
- `correct_category`: `transactionId` and the confirmed `category`.
- `set_budgets`: a `budgets` array of category/limit pairs.
- `sync_sheets`: creates Finora Financial Dashboard when absent, otherwise updates the connected workbook; optional `name` on creation.
- `sheet_connect`, `sheet_rename`, `sheet_copy`, `sheet_move`, `sheet_share`, `sheet_unshare`, and `sheet_disconnect` provide focused workbook management actions. `sheet_share` accepts `email` and optional `notify=false`; `sheet_unshare` accepts the same `email`.
- `sheet_add_tab` / `sheet_delete_tab`: `name`.
- `sheet_read_range`: bounded A1 `range`; use it before and after range edits.
- `sheet_append_rows`: `tab` and a nested `values` row array supplied through `@payload.json`.
- `sheet_update_range`: A1 `range` and a nested `values` row array supplied through `@payload.json`.
- `sheet_clear_range`: A1 `range`.
- `sheet_delete` permanently deletes the connected workbook and disconnects it; require explicit confirmation.
- `report_settings`: `enabled`, `frequency` (`weekly` or `monthly`), and `timezone`.
- `remove_budget`: `category`. `report_settings_clear` deletes the saved report preference.

Google Sheets and Gmail scopes are granted only in Finora's browser UI. When an action returns `actionRequired` and `actionUrl`, open that URL, approve the additional Google scope, then retry.
