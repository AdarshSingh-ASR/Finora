import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { reportPreference, user, userLedger } from "../db/schema";
import { getAuth } from "./auth";
import { detectSubscriptions, financialHealthScore, money, weeklyReport } from "./finance";
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

function isLocalDeliveryHour(timezone: string, reportDay: number, now: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((part) => part.type === "weekday")?.value || "");
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    return weekday === reportDay && hour === 8;
  } catch { return false; }
}

export async function sendDueWeeklyReports(options: { force?: boolean; now?: Date } = {}) {
  const db = getDb();
  const now = options.now || new Date();
  const cutoff = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const recipients = await db.select({ preference: reportPreference, ledger: userLedger, person: user })
    .from(reportPreference)
    .innerJoin(userLedger, eq(userLedger.userId, reportPreference.userId))
    .innerJoin(user, eq(user.id, reportPreference.userId))
    .where(eq(reportPreference.weeklyEmailEnabled, true));
  const dueRecipients = recipients.filter((row) => options.force || ((!row.preference.lastSentAt || row.preference.lastSentAt < cutoff) && isLocalDeliveryHour(row.preference.timezone, row.preference.reportDay, now)));
  const results: Array<{ userId: string; sent: boolean; error?: string }> = [];

  for (const row of dueRecipients) {
    try {
      const { accessToken } = await getAuth().api.getAccessToken({ body: { providerId: "google", userId: row.person.id } });
      if (!accessToken) throw new Error("Google Gmail permission is missing.");
      const email = buildWeeklyEmail(row.person.email, row.person.name, JSON.parse(row.ledger.statementJson), JSON.parse(row.ledger.budgetsJson));
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
