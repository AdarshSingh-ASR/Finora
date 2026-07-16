import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { reportPreference, user, userLedger } from "../db/schema";
import { getAuth } from "./auth";
import { detectSubscriptions, financialHealthScore, inPeriod, latestPeriod, money, normalizeMerchant, summarize, weeklyReport } from "./finance";
import type { Budget, StatementResult } from "./types";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

function base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Url(value: string) {
  return base64(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function buildWeeklyEmail(recipient: string, name: string, statement: StatementResult, budgets: Budget[]) {
  const report = weeklyReport(statement.transactions);
  const health = financialHealthScore(statement.transactions, budgets);
  const subscriptions = detectSubscriptions(statement.transactions);
  const subject = `Your Finora week: ${money(report.spent)} spent`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f3ec;color:#1b1d19;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:32px 20px"><div style="background:#161914;color:#fff;padding:28px;border-radius:20px"><div style="color:#d8fa48;font-size:13px;font-weight:700;letter-spacing:.12em">FINORA WEEKLY</div><h1 style="font-size:34px;margin:18px 0 6px">Hi ${escapeHtml(name.split(" ")[0] || "there")}, you spent ${escapeHtml(money(report.spent))}.</h1><p style="color:#b8bdb2;margin:0">${escapeHtml(report.start)} to ${escapeHtml(report.end)}</p></div><div style="background:#fff;padding:26px;margin-top:12px;border-radius:20px"><table style="width:100%;border-collapse:collapse"><tr><td style="padding:12px;border-bottom:1px solid #eee;color:#777">Largest category</td><td style="padding:12px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${escapeHtml(report.topCategory)}</td></tr><tr><td style="padding:12px;border-bottom:1px solid #eee;color:#777">Largest merchant</td><td style="padding:12px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${escapeHtml(report.topMerchant)}</td></tr><tr><td style="padding:12px;border-bottom:1px solid #eee;color:#777">Financial health</td><td style="padding:12px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${health.score}/100 · ${escapeHtml(health.label)}</td></tr><tr><td style="padding:12px;color:#777">Subscriptions</td><td style="padding:12px;text-align:right;font-weight:700">${escapeHtml(money(subscriptions.reduce((total, item) => total + item.monthlyCost, 0)))}/month</td></tr></table><div style="background:#efffba;padding:18px;border-radius:14px;margin-top:22px"><strong>One useful move</strong><p style="margin:7px 0 0;line-height:1.5">${escapeHtml(report.suggestion)}</p></div></div><p style="color:#8a8d84;font-size:12px;text-align:center;line-height:1.5">Sent by Finora using the Gmail permission you approved. Disable weekly reports any time in Finora.</p></div></body></html>`;
  const encodedSubject = `=?UTF-8?B?${base64(subject)}?=`;
  const mime = [`To: ${recipient}`, `From: ${recipient}`, `Subject: ${encodedSubject}`, "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "", html].join("\r\n");
  return { subject, raw: base64Url(mime), report };
}

export function buildMonthlyEmail(recipient: string, name: string, statement: StatementResult, budgets: Budget[]) {
  const period = latestPeriod(statement.transactions);
  const transactions = inPeriod(statement.transactions, period);
  const summary = summarize(transactions);
  const debits = transactions.filter((transaction) => transaction.type === "debit");
  const byCategory = debits.reduce<Record<string, number>>((acc, transaction) => { acc[transaction.category] = (acc[transaction.category] || 0) + transaction.amount; return acc; }, {});
  const byMerchant = debits.reduce<Record<string, number>>((acc, transaction) => { const merchant = normalizeMerchant(transaction.merchant); acc[merchant] = (acc[merchant] || 0) + transaction.amount; return acc; }, {});
  const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];
  const topMerchant = Object.entries(byMerchant).sort((a, b) => b[1] - a[1])[0];
  const largest = [...debits].sort((a, b) => b.amount - a.amount)[0];
  const health = financialHealthScore(statement.transactions, budgets);
  const subscriptions = detectSubscriptions(statement.transactions);
  const totalOutflow = summary.spend + summary.transfers;
  const subject = `Your Finora month: ${money(totalOutflow)} total outflow`;
  const suggestion = topCategory ? `Review ${topCategory[0]}, your largest outgoing category at ${money(topCategory[1])}. A 10% reduction would retain about ${money(topCategory[1] * .1)} next month.` : "Keep importing transactions to receive a useful monthly suggestion.";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f8f5;color:#10231c;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:32px 20px"><div style="background:#10231c;color:#fff;padding:28px;border-radius:18px"><div style="color:#55d9b5;font-size:13px;font-weight:700;letter-spacing:.12em">FINORA MONTHLY</div><h1 style="font-size:34px;margin:18px 0 6px">Hi ${escapeHtml(name.split(" ")[0] || "there")}, your outflow was ${escapeHtml(money(totalOutflow))}.</h1><p style="color:#aacabe;margin:0">${escapeHtml(period || "Latest imported period")}</p></div><div style="background:#fbfffd;padding:26px;margin-top:12px;border:1px solid #cde4db;border-radius:18px"><table style="width:100%;border-collapse:collapse"><tr><td style="padding:12px;border-bottom:1px solid #dcebe5;color:#587067">Consumption</td><td style="padding:12px;border-bottom:1px solid #dcebe5;text-align:right;font-weight:700">${escapeHtml(money(summary.spend))}</td></tr><tr><td style="padding:12px;border-bottom:1px solid #dcebe5;color:#587067">Transfers & investments</td><td style="padding:12px;border-bottom:1px solid #dcebe5;text-align:right;font-weight:700">${escapeHtml(money(summary.transfers))}</td></tr><tr><td style="padding:12px;border-bottom:1px solid #dcebe5;color:#587067">Largest category</td><td style="padding:12px;border-bottom:1px solid #dcebe5;text-align:right;font-weight:700">${escapeHtml(topCategory?.[0] || "None")}</td></tr><tr><td style="padding:12px;border-bottom:1px solid #dcebe5;color:#587067">Largest merchant</td><td style="padding:12px;border-bottom:1px solid #dcebe5;text-align:right;font-weight:700">${escapeHtml(topMerchant?.[0] || "None")}</td></tr><tr><td style="padding:12px;border-bottom:1px solid #dcebe5;color:#587067">Biggest outgoing</td><td style="padding:12px;border-bottom:1px solid #dcebe5;text-align:right;font-weight:700">${largest ? `${escapeHtml(normalizeMerchant(largest.merchant))} · ${escapeHtml(money(largest.amount))}` : "None"}</td></tr><tr><td style="padding:12px;border-bottom:1px solid #dcebe5;color:#587067">Financial health</td><td style="padding:12px;border-bottom:1px solid #dcebe5;text-align:right;font-weight:700">${health.score}/100 · ${escapeHtml(health.label)}</td></tr><tr><td style="padding:12px;color:#587067">Subscriptions</td><td style="padding:12px;text-align:right;font-weight:700">${escapeHtml(money(subscriptions.reduce((total, item) => total + item.monthlyCost, 0)))}/month</td></tr></table><div style="background:#dff5ec;padding:18px;border-radius:12px;margin-top:22px"><strong>One useful move</strong><p style="margin:7px 0 0;line-height:1.5">${escapeHtml(suggestion)}</p></div></div><p style="color:#7b9188;font-size:12px;text-align:center;line-height:1.5">Sent by Finora using the Gmail permission you approved. Change report frequency or disable delivery any time in Finora.</p></div></body></html>`;
  const encodedSubject = `=?UTF-8?B?${base64(subject)}?=`;
  const mime = [`To: ${recipient}`, `From: ${recipient}`, `Subject: ${encodedSubject}`, "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "", html].join("\r\n");
  return { subject, raw: base64Url(mime), report: { period, totalOutflow, consumption: summary.spend, transfers: summary.transfers, topCategory: topCategory?.[0] || "None", topMerchant: topMerchant?.[0] || "None", suggestion } };
}

function isLocalDeliveryHour(timezone: string, frequency: "weekly" | "monthly", reportDay: number, now: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", day: "numeric", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((part) => part.type === "weekday")?.value || "");
    const day = Number(parts.find((part) => part.type === "day")?.value);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    return frequency === "monthly" ? day === 1 && hour === 8 : weekday === reportDay && hour === 8;
  } catch { return false; }
}

export async function sendDueReports(options: { force?: boolean; now?: Date } = {}) {
  const db = getDb();
  const now = options.now || new Date();
  const recipients = await db.select({ preference: reportPreference, ledger: userLedger, person: user })
    .from(reportPreference)
    .innerJoin(userLedger, eq(userLedger.userId, reportPreference.userId))
    .innerJoin(user, eq(user.id, reportPreference.userId))
    .where(eq(reportPreference.weeklyEmailEnabled, true));
  const dueRecipients = recipients.filter((row) => {
    const frequency = row.preference.frequency === "monthly" ? "monthly" : "weekly";
    const cutoff = new Date(now.getTime() - (frequency === "monthly" ? 27 : 6) * 24 * 60 * 60 * 1000);
    return options.force || ((!row.preference.lastSentAt || row.preference.lastSentAt < cutoff) && isLocalDeliveryHour(row.preference.timezone, frequency, row.preference.reportDay, now));
  });
  const results: Array<{ userId: string; sent: boolean; error?: string }> = [];

  for (const row of dueRecipients) {
    try {
      const { accessToken } = await getAuth().api.getAccessToken({ body: { providerId: "google", userId: row.person.id } });
      if (!accessToken) throw new Error("Google Gmail permission is missing.");
      const email = row.preference.frequency === "monthly" ? buildMonthlyEmail(row.person.email, row.person.name, JSON.parse(row.ledger.statementJson), JSON.parse(row.ledger.budgetsJson)) : buildWeeklyEmail(row.person.email, row.person.name, JSON.parse(row.ledger.statementJson), JSON.parse(row.ledger.budgetsJson));
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw: email.raw }),
      });
      if (!response.ok) throw new Error(`Gmail rejected the report (${response.status}).`);
      await db.update(reportPreference).set({ lastSentAt: now, updatedAt: now }).where(eq(reportPreference.userId, row.person.id));
      results.push({ userId: row.person.id, sent: true });
    } catch (error) {
      results.push({ userId: row.person.id, sent: false, error: error instanceof Error ? error.message : "Delivery failed." });
    }
  }
  return { eligible: dueRecipients.length, sent: results.filter((result) => result.sent).length, results };
}

export const sendDueWeeklyReports = sendDueReports;
