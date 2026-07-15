const FINORA_SECRET = ""; // Optional: set the same secret in Finora.

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    if (FINORA_SECRET && payload.secret !== FINORA_SECRET) throw new Error("Invalid sync secret");
    const statement = payload.statement;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    writeLedger_(ss, statement.transactions || []);
    writeSummary_(ss, statement);
    return json_({ ok: true, url: ss.getUrl(), transactions: (statement.transactions || []).length });
  } catch (error) { return json_({ ok: false, error: String(error.message || error) }); }
}

function writeLedger_(ss, transactions) {
  const sheet = getSheet_(ss, "Transactions");
  sheet.clear();
  const rows = [["Date", "Merchant", "Description", "Type", "Amount", "Category", "Confidence", "Source"], ...transactions.map(t => [new Date(t.date), t.merchant, t.description, t.type, t.amount, t.category, t.confidence, t.source])];
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  styleHeader_(sheet, rows[0].length);
  if (rows.length > 1) { sheet.getRange(2, 1, rows.length - 1, 1).setNumberFormat("dd mmm yyyy"); sheet.getRange(2, 5, rows.length - 1, 1).setNumberFormat("₹#,##0.00"); sheet.getRange(2, 7, rows.length - 1, 1).setNumberFormat("0%"); }
  sheet.setFrozenRows(1); sheet.autoResizeColumns(1, rows[0].length); sheet.setColumnWidth(3, 340);
}

function writeSummary_(ss, statement) {
  const transactions = statement.transactions || [];
  const debits = transactions.filter(t => t.type === "debit");
  const income = transactions.filter(t => t.type === "credit").reduce((a, t) => a + Number(t.amount), 0);
  const spend = debits.reduce((a, t) => a + Number(t.amount), 0);
  const grouped = {};
  debits.forEach(t => grouped[t.category] = (grouped[t.category] || 0) + Number(t.amount));
  const categories = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const sheet = getSheet_(ss, "Finora Summary"); sheet.clear(); sheet.getCharts().forEach(c => sheet.removeChart(c));
  sheet.getRange("A1:F1").merge().setValue("FINORA / MONEY SNAPSHOT").setFontSize(18).setFontWeight("bold").setBackground("#171915").setFontColor("#d7ff46").setHorizontalAlignment("left");
  sheet.getRange("A3:B6").setValues([["Period", statement.period || "Imported statement"], ["Income", income], ["Spent", spend], ["Saved", income - spend]]);
  sheet.getRange("B4:B6").setNumberFormat("₹#,##0.00");
  sheet.getRange(8, 1, categories.length + 1, 2).setValues([["Category", "Amount"], ...categories]); styleHeaderAt_(sheet, 8, 2); sheet.getRange(9, 2, Math.max(1, categories.length), 1).setNumberFormat("₹#,##0.00");
  if (categories.length) {
    const chart = sheet.newChart().setChartType(Charts.ChartType.DOUGHNUT).addRange(sheet.getRange(8, 1, categories.length + 1, 2)).setPosition(3, 4, 0, 0).setOption("title", "Spend by category").setOption("pieHole", .55).setOption("legend.position", "right").build(); sheet.insertChart(chart);
  }
  sheet.setColumnWidth(1, 180); sheet.setColumnWidth(2, 130); sheet.setFrozenRows(1);
}

function getSheet_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }
function styleHeader_(sheet, columns) { styleHeaderAt_(sheet, 1, columns); }
function styleHeaderAt_(sheet, row, columns) { sheet.getRange(row, 1, 1, columns).setBackground("#275dff").setFontColor("white").setFontWeight("bold"); }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

