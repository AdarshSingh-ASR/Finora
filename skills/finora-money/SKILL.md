---
name: finora-money
description: Import, normalize, categorize, analyze, review, save, query, and sync personal bank, credit-card, receipt, and UPI transactions through the composable Finora MCP tools. Use for statement processing, merchant cleanup, spending summaries, month comparisons, subscriptions, duplicates, anomalies, budgets, health scores, natural-language money questions, corrections, exports, or Google Sheets reporting.
---

# Finora money

Use the smallest tool chain that satisfies the request. Treat tools as composable stages, not one mandatory pipeline.

## New statement workflow

1. Call `parse_statement` to extract raw transactions. This must not categorize, save, or sync.
2. Call `normalize_merchants` when merchant variants remain noisy.
3. Call `categorize_transactions` only when transactions lack reliable categories.
4. Present low-confidence classifications and likely P2P transfers for review.
5. Apply confirmed corrections before persistence. For already-saved transactions, use `correct_category`.
6. Call `save_transactions` only when the user asks to keep/import the reviewed ledger.
7. Call `sync_to_sheet` only after the user confirms categories look right or explicitly asks to sync without review.

Use `import_statement` only when the user explicitly wants the convenience parse → categorize → save path and review is unnecessary.

## Analysis routing

- Broad totals or a specified period → `summarize_transactions`.
- All imported months → `monthly_summary` or `spending_trends`.
- Two-month comparison → `compare_months`.
- Merchant totals or history → `merchant_analysis` or `search_transactions`.
- Recurring costs and renewal estimates → `detect_subscriptions`.
- Same-amount charges close together → `find_duplicate_transactions`.
- Category jumps or unfamiliar high-value merchants → `detect_spending_anomalies`.
- Category limit usage → `budget_status`.
- Transparent 0–100 assessment → `financial_health_score`; report its breakdown, not only the score.
- Open-ended ledger question → retrieve the narrowest evidence first, then use `answer_finance_question` when synthesis is needed.
- Existing reviewed ledger to Sheets → `export_sheet`.

## Judgment and safety

- Treat amounts as positive and use debit/credit for direction.
- Exclude Transfers and Investments from consumption totals. Never assume a P2P transfer is spending without evidence.
- Treat subscription renewal dates as estimates.
- Label duplicates and anomalies as review candidates, not confirmed fraud or errors.
- State the period and transaction count when scope is ambiguous.
- Never echo full account numbers, UPI IDs, or raw sensitive narrations unless necessary.
- Do not provide investment, tax, or legal advice. Frame forecasts and safe-to-spend amounts as estimates.

Read [references/categories.md](references/categories.md) only when category boundaries or correction policy matter.

