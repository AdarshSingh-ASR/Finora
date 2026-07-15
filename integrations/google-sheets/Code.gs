const FINORA_SECRET = ""; // Optional: set the same secret in Finora.

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    if (FINORA_SECRET && payload.secret !== FINORA_SECRET) throw new Error("Invalid sync secret");
    const statement = payload.statement || {};
    const transactions = statement.transactions || [];
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    writeLedger_(ss, transactions);
    writeMonthly_(ss, transactions);
    writeCategories_(ss, transactions);
    writeMerchants_(ss, transactions);
    writeSubscriptions_(ss, transactions);
    writeSummary_(ss, statement, transactions);
    writePivot_(ss, transactions.length);
    return json_({ ok: true, url: ss.getUrl(), transactions: transactions.length, tabs: 7 });
  } catch (error) { return json_({ ok: false, error: String(error.message || error) }); }
}

function writeLedger_(ss, transactions) {
  const sheet = freshSheet_(ss, "Transactions");
  const rows = [["Date", "Month", "Merchant", "Description", "Type", "Amount", "Category", "Confidence", "Source"], ...transactions.map(t => [new Date(t.date), month_(t.date), t.merchant, t.description, t.type, Number(t.amount), t.category, Number(t.confidence || 0), t.source])];
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows); styleHeader_(sheet, rows[0].length);
  if (rows.length > 1) { sheet.getRange(2, 1, rows.length - 1, 1).setNumberFormat("dd mmm yyyy"); sheet.getRange(2, 6, rows.length - 1, 1).setNumberFormat("₹#,##0.00"); sheet.getRange(2, 8, rows.length - 1, 1).setNumberFormat("0%"); }
  sheet.setFrozenRows(1); sheet.autoResizeColumns(1, rows[0].length); sheet.setColumnWidth(4, 340); sheet.getDataRange().createFilter();
}

function writeMonthly_(ss, transactions) {
  const grouped = {};
  transactions.forEach(t => { const month = month_(t.date); grouped[month] ||= { income: 0, spend: 0, investment: 0 }; if (t.type === "credit") grouped[month].income += Number(t.amount); else if (["Transfers", "Investment"].includes(t.category)) grouped[month].investment += Number(t.amount); else grouped[month].spend += Number(t.amount); });
  const rows = [["Month", "Income", "Consumption", "Transfers & investments", "Saved"], ...Object.keys(grouped).sort().map(month => [month, grouped[month].income, grouped[month].spend, grouped[month].investment, grouped[month].income - grouped[month].spend - grouped[month].investment])];
  const sheet = freshSheet_(ss, "Monthly Summary"); sheet.getRange(1, 1, rows.length, 5).setValues(rows); styleHeader_(sheet, 5); if (rows.length > 1) sheet.getRange(2, 2, rows.length - 1, 4).setNumberFormat("₹#,##0.00"); sheet.autoResizeColumns(1, 5);
  if (rows.length > 1) sheet.insertChart(sheet.newChart().setChartType(Charts.ChartType.COLUMN).addRange(sheet.getRange(1, 1, rows.length, 3)).setPosition(2, 7, 0, 0).setOption("title", "Income vs consumption by month").setOption("colors", ["#2c9f6b", "#275dff"]).build());
}

function writeCategories_(ss, transactions) {
  const grouped = {}; transactions.filter(t => t.type === "debit" && !["Transfers", "Investment"].includes(t.category)).forEach(t => { const key = month_(t.date) + "|" + t.category; grouped[key] = (grouped[key] || 0) + Number(t.amount); });
  const rows = [["Month", "Category", "Amount"], ...Object.entries(grouped).map(([key, amount]) => [...key.split("|"), amount]).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(b[2]) - Number(a[2]))];
  const sheet = freshSheet_(ss, "Category Summary"); sheet.getRange(1, 1, rows.length, 3).setValues(rows); styleHeader_(sheet, 3); if (rows.length > 1) sheet.getRange(2, 3, rows.length - 1, 1).setNumberFormat("₹#,##0.00"); sheet.autoResizeColumns(1, 3);
  const latest = rows.length > 1 ? rows.map(r => r[0]).slice(1).sort().pop() : ""; const latestRows = rows.filter((r, i) => i === 0 || r[0] === latest); if (latestRows.length > 1) { sheet.getRange(1, 5, latestRows.length, 2).setValues([["Latest category", "Amount"], ...latestRows.slice(1).map(r => [r[1], r[2]])]); sheet.insertChart(sheet.newChart().setChartType(Charts.ChartType.DOUGHNUT).addRange(sheet.getRange(1, 5, latestRows.length, 2)).setPosition(2, 8, 0, 0).setOption("title", "Latest month by category").setOption("pieHole", .55).build()); }
}

function writeMerchants_(ss, transactions) {
  const grouped = {}; transactions.filter(t => t.type === "debit").forEach(t => { grouped[t.merchant] ||= { amount: 0, count: 0 }; grouped[t.merchant].amount += Number(t.amount); grouped[t.merchant].count++; });
  const rows = [["Merchant", "Total", "Payments", "Average"], ...Object.entries(grouped).map(([merchant, value]) => [merchant, value.amount, value.count, value.amount / value.count]).sort((a, b) => b[1] - a[1])];
  const sheet = freshSheet_(ss, "Merchant Summary"); sheet.getRange(1, 1, rows.length, 4).setValues(rows); styleHeader_(sheet, 4); if (rows.length > 1) { sheet.getRange(2, 2, rows.length - 1, 1).setNumberFormat("₹#,##0.00"); sheet.getRange(2, 4, rows.length - 1, 1).setNumberFormat("₹#,##0.00"); } sheet.autoResizeColumns(1, 4);
}

function writeSubscriptions_(ss, transactions) {
  const grouped = {}; transactions.filter(t => t.type === "debit").forEach(t => { grouped[t.merchant] ||= []; grouped[t.merchant].push(t); });
  const found = Object.entries(grouped).flatMap(([merchant, items]) => { items.sort((a, b) => new Date(a.date) - new Date(b.date)); const average = items.reduce((a, t) => a + Number(t.amount), 0) / items.length; const stable = items.every(t => Math.abs(Number(t.amount) - average) / Math.max(average, 1) <= .12); const cadence = items.slice(1).some((t, i) => { const days = (new Date(t.date) - new Date(items[i].date)) / 86400000; return days >= 24 && days <= 38; }); if (!(items.length >= 2 && stable && cadence) && !/Netflix|Spotify|ChatGPT|Claude|Cult|Prime|Google One|Apple|Canva/i.test(merchant)) return []; const renewal = new Date(items[items.length - 1].date); renewal.setDate(renewal.getDate() + 30); return [[merchant, average, average * 12, items.length, renewal]]; });
  const rows = [["Subscription", "Monthly cost", "Annual cost", "Occurrences", "Estimated renewal"], ...found]; const sheet = freshSheet_(ss, "Subscriptions"); sheet.getRange(1, 1, rows.length, 5).setValues(rows); styleHeader_(sheet, 5); if (rows.length > 1) { sheet.getRange(2, 2, rows.length - 1, 2).setNumberFormat("₹#,##0.00"); sheet.getRange(2, 5, rows.length - 1, 1).setNumberFormat("dd mmm yyyy"); } sheet.autoResizeColumns(1, 5);
}

function writeSummary_(ss, statement, transactions) {
  const sheet = freshSheet_(ss, "Finora Summary"); const latest = transactions.map(t => month_(t.date)).sort().pop() || "Imported"; const current = transactions.filter(t => month_(t.date) === latest), income = current.filter(t => t.type === "credit").reduce((a, t) => a + Number(t.amount), 0), spend = current.filter(t => t.type === "debit" && !["Transfers", "Investment"].includes(t.category)).reduce((a, t) => a + Number(t.amount), 0), investments = current.filter(t => t.type === "debit" && ["Transfers", "Investment"].includes(t.category)).reduce((a, t) => a + Number(t.amount), 0);
  sheet.getRange("A1:F1").merge().setValue("FINORA / MONEY SNAPSHOT").setFontSize(18).setFontWeight("bold").setBackground("#171915").setFontColor("#d7ff46");
  sheet.getRange("A3:B7").setValues([["Latest month", latest], ["Income", income], ["Consumption", spend], ["Transfers & investments", investments], ["Saved", income - spend - investments]]); sheet.getRange("B4:B7").setNumberFormat("₹#,##0.00");
  sheet.getRange("A10:B10").setValues([["AI observations", ""]]).setBackground("#275dff").setFontColor("white").setFontWeight("bold"); (statement.insights || []).forEach((insight, index) => sheet.getRange(11 + index, 1, 1, 2).merge().setValue("• " + insight)); sheet.setColumnWidth(1, 220); sheet.setColumnWidth(2, 190); sheet.setFrozenRows(1);
}

function writePivot_(ss, transactionCount) {
  const sheet = freshSheet_(ss, "Pivot Analysis"); if (!transactionCount) return;
  const source = ss.getSheetByName("Transactions").getRange(1, 1, transactionCount + 1, 9); const pivot = sheet.getRange("A1").createPivotTable(source); pivot.addRowGroup(7); pivot.addColumnGroup(2); pivot.addPivotValue(6, SpreadsheetApp.PivotTableSummarizeFunction.SUM); sheet.getRange("A1").setNote("Live category-by-month pivot generated by Finora");
}

function month_(date) { return Utilities.formatDate(new Date(date), Session.getScriptTimeZone(), "yyyy-MM"); }
function freshSheet_(ss, name) { const sheet = ss.getSheetByName(name) || ss.insertSheet(name); sheet.clear(); sheet.getCharts().forEach(chart => sheet.removeChart(chart)); return sheet; }
function styleHeader_(sheet, columns) { sheet.getRange(1, 1, 1, columns).setBackground("#275dff").setFontColor("white").setFontWeight("bold"); sheet.setFrozenRows(1); }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

