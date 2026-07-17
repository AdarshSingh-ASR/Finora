"use client";
/* Google OAuth avatars are remote user content, so they intentionally use the native img element. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity, AlertCircle, ArrowDownLeft, ArrowUpRight, BadgeCheck, Bot, CalendarDays,
  Camera, Check, ChevronDown, ChevronRight, CircleHelp, Copy, CopyCheck, ExternalLink, FileSpreadsheet,
  FileText, Gauge, LayoutDashboard, LoaderCircle, LockKeyhole, Menu, MoreHorizontal,
  ReceiptIndianRupee, Repeat2, Search, ShieldCheck, Sparkles, UploadCloud,
  X, Zap, LogOut, Mail, UserRound, Plus, Trash2, Database, ArrowRight, MessageSquare,
  Files, Folder, Pencil, RefreshCw, Share2, Unlink,
  Paperclip, Play, FileCheck2,
} from "lucide-react";
import { budgetStatus, categories, compareMonths, detectAnomalies, detectSubscriptions, financialHealthScore, findDuplicateTransactions, inPeriod, latestPeriod, money, summarize, weeklyReport } from "../../lib/finance";
import { analystMarkdown, buildAnalystResponse, chartColors, sanitizeAnalystResponse, type AnalystChart, type AnalystResponse } from "../../lib/analyst";
import { categoryColors } from "../../lib/category-colors";
import type { Budget, Category, StatementResult, Transaction } from "../../lib/types";
import { authClient, signIn, signOut, useSession } from "../../lib/auth-client";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { NumberTicker } from "../../components/magicui/number-ticker";
import { BorderBeam } from "../../components/magicui/border-beam";
import { fallbackAgentActions, sanitizeAgentActions, type AgentAction, type ChatAttachmentMeta } from "../../lib/agent-actions";

type View = "overview" | "transactions" | "reports" | "agent";
type Toast = { tone: "good" | "bad"; message: string } | null;
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; analysis?: AnalystResponse; actions?: AgentAction[]; attachments?: ChatAttachmentMeta[]; evidenceScope?: "attachments" | "combined" | "ledger" };
type ChatThread = { id: string; title: string; messages: ChatMessage[]; attachmentContext?: ChatAttachment[]; createdAt: string; updatedAt: string };
type ChatAttachment = ChatAttachmentMeta & { mimeType: string; status: "reading" | "ready" | "error"; statement?: StatementResult; error?: string };
type SheetConnection = { spreadsheetId: string; spreadsheetUrl: string; name: string; folderId?: string | null; lastSyncedAt: string; stale?: boolean };
type SheetFile = { id: string; name: string; webViewLink?: string; modifiedTime?: string; parents?: string[] };

const emptyStatement: StatementResult = { accountName: "", bankName: "", period: "", currency: "INR", transactions: [], insights: [] };

function statementFromAttachments(attachments: ChatAttachment[], base?: StatementResult): StatementResult | null {
  const ready = attachments.filter((attachment) => attachment.status === "ready" && attachment.statement);
  if (!ready.length) return base || null;
  const first = ready[0].statement!;
  const transactions = [...(base?.transactions || [])];
  const known = new Set(transactions.map((transaction) => `${transaction.date}|${transaction.merchant.toLowerCase()}|${transaction.type}|${transaction.amount}`));
  for (const transaction of ready.flatMap((attachment) => attachment.statement?.transactions || [])) {
    const key = `${transaction.date}|${transaction.merchant.toLowerCase()}|${transaction.type}|${transaction.amount}`;
    if (!known.has(key)) { transactions.push(transaction); known.add(key); }
  }
  return {
    accountName: base?.accountName || first.accountName, bankName: base?.bankName || first.bankName,
    period: base?.period || first.period, currency: base?.currency || first.currency, transactions,
    insights: [...ready.flatMap((attachment) => attachment.statement?.insights || []), ...(base?.insights || [])].slice(0, 3),
  };
}

function MiniTrend({ values, large = false }: { values: number[]; large?: boolean }) {
  if (!values.length) return null;
  const maximum = Math.max(...values, 1), denominator = Math.max(1, values.length - 1);
  const points = values.map((value, index) => `${(index / denominator) * 100},${70 - (value / maximum) * 54}`).join(" ");
  const gradientId = large ? "area-large" : "area-small";
  return (
    <svg className={large ? "trend-chart dashboard-trend-chart" : "trend-chart"} viewBox="0 0 100 75" preserveAspectRatio="none" aria-label="Spending trend">
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#16b88b" stopOpacity=".3"/><stop offset="1" stopColor="#16b88b" stopOpacity="0"/></linearGradient></defs>
      <path d={`M0,75 L${points} L100,75 Z`} fill={`url(#${gradientId})`} />
      <polyline points={points} fill="none" stroke="#0f9c74" strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function analystValue(value: number, unit: AnalystChart["unit"]) {
  if (unit === "currency") return money(value);
  if (unit === "percent") return `${Math.round(value)}%`;
  return new Intl.NumberFormat("en-IN").format(value);
}

function AnalystChartView({ chart }: { chart: AnalystChart }) {
  const [selected, setSelected] = useState(0);
  const total = chart.data.reduce((sum, point) => sum + point.value, 0);
  const maximum = Math.max(...chart.data.map((point) => point.value), 1);
  const active = chart.data[Math.min(selected, chart.data.length - 1)] || chart.data[0];
  const linePoints = chart.data.map((point, index) => ({
    x: chart.data.length === 1 ? 310 : 26 + index / (chart.data.length - 1) * 568,
    y: 148 - point.value / maximum * 116,
  }));
  const donut = chart.data.reduce<{ cursor: number; parts: string[] }>((state, point, index) => {
    const end = state.cursor + (total ? point.value / total * 360 : 0);
    state.parts.push(`${chartColors[index % chartColors.length]} ${state.cursor}deg ${end}deg`);
    state.cursor = end;
    return state;
  }, { cursor: 0, parts: [] });

  return <section className="analyst-chart" aria-label={chart.title}>
    <header><div><small>VISUAL BREAKDOWN</small><h4>{chart.title}</h4>{chart.subtitle && <p>{chart.subtitle}</p>}</div><span>{chart.type}</span></header>
    {chart.type === "bar" && <div className="analyst-bar-list">
      {chart.data.map((point, index) => <button key={`${point.label}-${index}`} className={selected === index ? "active" : ""} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onClick={() => setSelected(index)}>
        <span><strong>{point.label}</strong><em>{analystValue(point.value, chart.unit)}</em></span><i><b style={{ width: `${Math.max(3, point.value / maximum * 100)}%`, background: chartColors[index % chartColors.length] }}/></i>
      </button>)}
    </div>}
    {chart.type === "line" && <div className="analyst-line-wrap">
      <svg viewBox="0 0 620 170" role="img" aria-label={`${chart.title} line chart`}>
        <defs><linearGradient id={`analyst-area-${chart.title.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#16b88b" stopOpacity=".28"/><stop offset="1" stopColor="#16b88b" stopOpacity="0"/></linearGradient></defs>
        {[32, 70, 109, 148].map((y) => <line key={y} x1="26" x2="594" y1={y} y2={y} className="analyst-grid-line"/>)}
        {linePoints.length > 1 && <path d={`M${linePoints[0].x},148 L${linePoints.map((point) => `${point.x},${point.y}`).join(" L")} L${linePoints.at(-1)!.x},148 Z`} fill={`url(#analyst-area-${chart.title.replace(/\W/g, "")})`}/>}
        <polyline points={linePoints.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#0d9f76" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        {linePoints.map((point, index) => <circle key={`${chart.data[index].label}-${index}`} cx={point.x} cy={point.y} r={selected === index ? 7 : 5} tabIndex={0} role="button" aria-label={`${chart.data[index].label}: ${analystValue(chart.data[index].value, chart.unit)}`} className={selected === index ? "active" : ""} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onClick={() => setSelected(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelected(index); }}/>) }
      </svg>
      <div className="analyst-line-labels">{chart.data.map((point, index) => <button className={selected === index ? "active" : ""} key={`${point.label}-${index}`} onClick={() => setSelected(index)}>{point.label}</button>)}</div>
    </div>}
    {chart.type === "donut" && <div className="analyst-donut-wrap">
      <button className="analyst-donut" style={{ background: `conic-gradient(${donut.parts.join(", ") || "#dce9e4 0deg 360deg"})` }} aria-label={`${chart.title}: ${analystValue(total, chart.unit)}`}><span><small>Total</small><strong>{analystValue(total, chart.unit)}</strong></span></button>
      <div>{chart.data.map((point, index) => <button key={`${point.label}-${index}`} className={selected === index ? "active" : ""} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onClick={() => setSelected(index)}><i style={{ background: chartColors[index % chartColors.length] }}/><span>{point.label}</span><strong>{analystValue(point.value, chart.unit)}</strong></button>)}</div>
    </div>}
    {active && <div className="analyst-chart-focus"><span>{active.label}</span><strong>{analystValue(active.value, chart.unit)}</strong>{active.detail && <small>{active.detail}</small>}</div>}
  </section>;
}

function AnalystReport({ analysis, onAsk }: { analysis: AnalystResponse; onAsk: (prompt?: string) => void }) {
  return <section className={`finora-analyst-report ${analysis.kind}`} aria-label={`${analysis.title} analytical report`}>
    <header className="analyst-report-head"><div><small><Activity size={12}/>FINORA ANALYST BRIEF</small><h3>{analysis.title}</h3><p>{analysis.scope}</p></div><span>{analysis.kind === "report" ? "REPORT" : "LIVE ANALYSIS"}</span></header>
    {analysis.metrics.length > 0 && <div className="analyst-metrics">{analysis.metrics.map((metric, index) => <article className={metric.tone || "neutral"} key={`${metric.label}-${index}`}><small>{metric.label}</small><strong>{metric.value}</strong>{metric.detail && <p>{metric.detail}</p>}</article>)}</div>}
    {(analysis.chart || analysis.table) && <div className={`analyst-evidence-grid ${analysis.chart && analysis.table ? "split" : ""}`}>
      {analysis.chart && <AnalystChartView chart={analysis.chart}/>}
      {analysis.table && <section className="analyst-table-wrap"><header><small>SUPPORTING DETAIL</small><h4>{analysis.table.title}</h4></header><div><table><thead><tr>{analysis.table.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{analysis.table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div></section>}
    </div>}
    {analysis.insights.length > 0 && <section className="analyst-insights"><header><Sparkles size={14}/><span>What Finora noticed</span></header><div>{analysis.insights.map((insight, index) => <article className={insight.tone} key={`${insight.title}-${index}`}><i/><span><strong>{insight.title}</strong><p>{insight.detail}</p></span></article>)}</div></section>}
    {analysis.followUps.length > 0 && <div className="analyst-followups"><small>EXPLORE THIS FURTHER</small><div>{analysis.followUps.map((prompt) => <button key={prompt} onClick={() => onAsk(prompt)}>{prompt}<ArrowUpRight size={13}/></button>)}</div></div>}
  </section>;
}

function WorkspaceSkeleton() {
  return <section className="workspace-skeleton" aria-label="Loading your account"><Skeleton className="skeleton-kicker"/><Skeleton className="skeleton-title"/><div className="skeleton-grid">{Array.from({ length: 4 }, (_, index) => <Skeleton className="skeleton-card" key={index}/>)}</div><div className="skeleton-panels"><Skeleton/><Skeleton/></div></section>;
}

function EmptyWorkspace({ signedIn, uploading, uploadLabel, onSignIn, onUpload }: { signedIn: boolean; uploading: boolean; uploadLabel: string; onSignIn: () => void; onUpload: () => void }) {
  return <section className="empty-workspace">
    <div className="empty-orbit"><span><Database size={29}/></span><i/><i/><i/></div>
    <p className="eyebrow"><span className="live-dot"/>{signedIn ? "YOUR PRIVATE MONEY SPACE" : "PRIVATE BY DEFAULT"}</p>
    <h1>{signedIn ? <>Start with a<br/><em>real statement.</em></> : <>Your money,<br/><em>finally legible.</em></>}</h1>
    <p>{signedIn ? "Import a bank, card, or UPI statement. Finora will build this dashboard only from transactions it actually finds." : "Sign in with Google to create a private ledger, save corrections, and receive your weekly money story."}</p>
    <div className="empty-actions">{signedIn ? <Button size="lg" onClick={onUpload} disabled={uploading}>{uploading ? <><LoaderCircle className="spin" size={17}/>{uploadLabel}</> : <><UploadCloud size={17}/>Import statement</>}</Button> : <Button size="lg" onClick={onSignIn}><UserRound size={17}/>Continue with Google<ArrowRight size={16}/></Button>}</div>
    {signedIn && <div className="format-row"><span>PDF</span><span>CSV</span><span>Excel</span><span>Screenshot</span><span>UPI</span></div>}
    <small><ShieldCheck size={13}/>{signedIn ? "No sample transactions. Your dashboard starts empty." : "Your normalized ledger is stored under your account."}</small>
    <BorderBeam/>
  </section>;
}

const financePrompts = [
  "Where did I spend the most this month?",
  "Find possible duplicate payments",
  "Show my recurring subscriptions",
  "Compare this month with the previous month",
];

function ChatWorkspace({ messages, question, asking, transactionCount, attachments, contextAttachments, attachmentBusy, runningActionId, onQuestion, onAsk, onAttach, onRemoveAttachment, onRunAction, endRef }: {
  messages: ChatMessage[];
  question: string;
  asking: boolean;
  transactionCount: number;
  attachments: ChatAttachment[];
  contextAttachments: ChatAttachment[];
  attachmentBusy: boolean;
  runningActionId: string | null;
  onQuestion: (value: string) => void;
  onAsk: (prompt?: string) => void;
  onAttach: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
  onRunAction: (messageId: string, action: AgentAction) => void;
  endRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const attachmentRef = useRef<HTMLInputElement>(null);
  const readyAttachments = [...contextAttachments, ...attachments].filter((attachment) => attachment.status === "ready");
  const attachedTransactionCount = readyAttachments.reduce((total, attachment) => total + attachment.transactionCount, 0);

  async function copyReply(message: ChatMessage) {
    await navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId((current) => current === message.id ? null : current), 1800);
  }

  return <section className="finora-chat-page" aria-label="Chat with Finora">
    <div className="finora-chat-body">
      <div className="finora-chat-conversation">
        <div className="finora-chat-thread" aria-live="polite">
          {messages.length === 0 && <div className="finora-chat-welcome">
            <span><Sparkles size={22}/></span>
            <p className="eyebrow">YOUR FINANCIAL COPILOT</p>
            <h1>Ask, analyze,<br/>or get it done.</h1>
            <p>Attach statements, receipts, or spreadsheets. Finora can answer from them, add transactions to your ledger, update Google Sheets, and prepare reports.</p>
            <div className="finora-chat-suggestions">{financePrompts.map((prompt) => <button key={prompt} onClick={() => onAsk(prompt)}>{prompt}<ArrowUpRight size={15}/></button>)}</div>
          </div>}

          {messages.map((message) => <article className={`finora-chat-message ${message.role}`} key={message.id}>
            <div className="finora-chat-avatar">{message.role === "assistant" ? <Mark/> : <UserRound size={16}/>}</div>
            <div>
              <span>{message.role === "assistant" ? "Finora" : "You"}</span>
              {message.role === "assistant" ? <><div className="finora-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>{message.analysis && <AnalystReport analysis={message.analysis} onAsk={onAsk}/>}</> : <>{message.attachments?.length ? <div className="finora-message-files">{message.attachments.map((file) => <span key={file.id}><FileCheck2 size={13}/><b>{file.name}</b><small>{file.transactionCount} found</small></span>)}</div> : null}<p>{message.content}</p></>}
              {message.role === "assistant" && message.actions?.length ? <section className="finora-agent-actions" aria-label="Finora actions">
                <header><span><Zap size={13}/>READY TO DO</span><small>Nothing runs until you approve it.</small></header>
                <div>{message.actions.map((action) => <article className={action.status} key={action.id}>
                  <span className="finora-action-icon">{action.status === "completed" ? <Check size={15}/> : action.status === "running" ? <LoaderCircle className="spin" size={15}/> : <Play size={15}/>}</span>
                  <div><strong>{action.label}</strong><p>{action.description}</p>{action.result && <small>{action.result}</small>}</div>
                  <button type="button" disabled={action.status === "completed" || runningActionId === action.id} onClick={() => onRunAction(message.id, action)}>{action.status === "completed" ? "Done" : action.requiresConfirmation ? "Review & run" : "Run"}</button>
                </article>)}</div>
              </section> : null}
              {message.role === "assistant" && <div className="finora-message-actions">
                <small><ShieldCheck size={11}/>{message.evidenceScope === "attachments" ? "Based on attached files" : message.evidenceScope === "combined" ? "Based on attached files + saved ledger" : "Based on your saved ledger"}</small>
                <button type="button" onClick={() => void copyReply(message)} aria-label={copiedId === message.id ? "Reply copied" : "Copy reply"} title={copiedId === message.id ? "Copied" : "Copy reply"}>
                  {copiedId === message.id ? <Check size={13}/> : <Copy size={13}/>}<span>{copiedId === message.id ? "Copied" : "Copy"}</span>
                </button>
              </div>}
            </div>
          </article>)}

          {asking && <article className="finora-chat-message assistant thinking"><div className="finora-chat-avatar"><Mark/></div><div><span>Finora</span><p><i/><i/><i/></p><small>Reading your ledger and conversation…</small></div></article>}
          <div ref={endRef}/>
        </div>

        <div className="finora-chat-composer-wrap">
          <form className="finora-chat-composer" onSubmit={(event) => { event.preventDefault(); onAsk(); }}>
            {attachments.length > 0 && <div className="finora-attachment-strip">{attachments.map((attachment) => <span className={attachment.status} key={attachment.id}><FileText size={13}/><b>{attachment.name}</b><small>{attachment.status === "reading" ? "Reading…" : attachment.status === "error" ? attachment.error : `${attachment.transactionCount} transactions`}</small><button type="button" onClick={() => onRemoveAttachment(attachment.id)} aria-label={`Remove ${attachment.name}`}><X size={12}/></button></span>)}</div>}
            <textarea rows={1} value={question} onChange={(event) => onQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onAsk(); } }} placeholder="Ask anything about your money…" aria-label="Message Finora"/>
            <div className="finora-composer-foot"><span><Database size={12}/>{transactionCount} saved{attachedTransactionCount ? ` · ${attachedTransactionCount} attached` : ""}</span><div className="finora-composer-buttons"><button type="button" className="attach" onClick={() => attachmentRef.current?.click()} disabled={attachmentBusy || attachments.length >= 8} aria-label="Attach financial files" title="Attach financial files"><Paperclip size={17}/></button><button type="submit" disabled={!question.trim() || asking || attachments.some((attachment) => attachment.status === "reading")} aria-label="Send message"><ArrowUpRight size={18}/></button></div></div>
            <input ref={attachmentRef} type="file" multiple hidden accept=".pdf,.csv,.tsv,.txt,.xlsx,.xls,image/png,image/jpeg" onChange={(event) => { if (event.target.files?.length) onAttach(event.target.files); event.target.value = ""; }}/>
          </form>
          <small>Finora answers from your imported ledger. Verify important financial decisions.</small>
        </div>
      </div>
    </div>
  </section>;
}

function ReportsPage({ frequency, enabled, timezone, period, outflow, consumption, transfers, topCategory, topMerchant, largest, healthScore, healthLabel, suggestion, onFrequency, onTimezone, onEnable, onDisable }: {
  frequency: "weekly" | "monthly"; enabled: boolean; timezone: string; period: string; outflow: number; consumption: number; transfers: number; topCategory: string; topMerchant: string; largest: string; healthScore: number; healthLabel: string; suggestion: string;
  onFrequency: (frequency: "weekly" | "monthly") => void; onTimezone: (timezone: string) => void; onEnable: () => void; onDisable: () => void;
}) {
  return <section className="view-page reports-page">
    <div className="reports-heading"><div><p className="eyebrow"><span className="live-dot"/>YOUR MONEY, ON SCHEDULE</p><h1>AI Reports</h1><p>Choose the rhythm. Finora turns your real ledger into a concise money story and delivers it privately to your Gmail.</p></div><span className={`report-status ${enabled ? "on" : ""}`}><i/>{enabled ? `${frequency === "monthly" ? "Monthly" : "Weekly"} delivery on` : "Email delivery off"}</span></div>
    <div className="report-frequency-grid" role="radiogroup" aria-label="AI report frequency">
      <button className={frequency === "weekly" ? "selected" : ""} role="radio" aria-checked={frequency === "weekly"} onClick={() => onFrequency("weekly")}><span><CalendarDays size={20}/></span><small>01 · WEEKLY</small><strong>Every Sunday</strong><p>A seven-day pulse with total outflow, categories, merchants, subscriptions, and one useful move.</p><i>{frequency === "weekly" ? <Check size={14}/> : null}</i></button>
      <button className={frequency === "monthly" ? "selected" : ""} role="radio" aria-checked={frequency === "monthly"} onClick={() => onFrequency("monthly")}><span><FileText size={20}/></span><small>02 · MONTHLY</small><strong>First of every month</strong><p>A fuller month-end review with consumption, transfers, health, recurring costs, and the largest changes.</p><i>{frequency === "monthly" ? <Check size={14}/> : null}</i></button>
    </div>
    <div className="reports-workspace">
      <article className="report-preview">
        <div className="report-preview-head"><div><Mark/><span><small>FINORA {frequency.toUpperCase()}</small><strong>{frequency === "weekly" ? "Your weekly money story" : "Your monthly money story"}</strong></span></div><em>PREVIEW</em></div>
        <div className="report-total"><small>TOTAL OUTFLOW</small><strong>{money(outflow)}</strong><span>{period}</span></div>
        <div className="report-preview-grid"><span><small>Consumption</small><strong>{money(consumption)}</strong></span><span><small>Transfers & investments</small><strong>{money(transfers)}</strong></span><span><small>Largest category</small><strong>{topCategory}</strong></span><span><small>Largest merchant</small><strong>{topMerchant}</strong></span><span><small>Biggest outgoing</small><strong>{largest}</strong></span><span><small>Financial health</small><strong>{healthScore}/100 · {healthLabel}</strong></span></div>
        <div className="report-move"><Sparkles size={16}/><span><small>FINORA SUGGESTS</small><p>{suggestion}</p></span></div>
      </article>
      <aside className="report-delivery-panel">
        <span className="report-delivery-icon"><Mail size={22}/></span><p className="eyebrow">PRIVATE GMAIL DELIVERY</p><h2>{enabled ? "Your report is scheduled." : "Get this report automatically."}</h2><p>{frequency === "weekly" ? "Finora will send this every Sunday at 8:00 AM in your selected timezone." : "Finora will send the completed monthly review on the first day of each month at 8:00 AM."}</p>
        <label>Timezone<select value={timezone} onChange={(event) => onTimezone(event.target.value)}><option value="Asia/Kolkata">India · Asia/Kolkata</option><option value="America/New_York">US · New York</option><option value="America/Los_Angeles">US · Los Angeles</option><option value="Europe/London">UK · London</option><option value="Asia/Singapore">Singapore</option></select></label>
        {enabled ? <button className="report-disable" onClick={onDisable}><X size={15}/>Turn off email delivery</button> : <button className="report-enable" onClick={onEnable}><Mail size={16}/>Allow Gmail & schedule report</button>}
        <small><ShieldCheck size={12}/>Finora can send this report but cannot read your inbox.</small>
      </aside>
    </div>
  </section>;
}

function Mark() {
  return <span className="mark" aria-hidden="true"><span>F</span></span>;
}

function CategoryBadge({ category }: { category: string }) {
  return <span className="category-badge"><i style={{ background: categoryColors[category] || "#aaa" }} />{category}</span>;
}

function TransactionRow({ transaction, onCategory }: { transaction: Transaction; onCategory: (value: Category) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="transaction-row">
      <div className="merchant-cell">
        <span className={`merchant-icon ${transaction.type}`}>
          {transaction.type === "credit" ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
        </span>
        <span><strong>{transaction.merchant}</strong><small>{transaction.description}</small></span>
      </div>
      <span className="date-cell">{new Date(transaction.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
      <div className="category-cell">
        {editing ? (
          <select value={transaction.category} onChange={(event) => { onCategory(event.target.value as Category); setEditing(false); }} onBlur={() => setEditing(false)} autoFocus>
            {categories.map((category) => <option key={category}>{category}</option>)}
          </select>
        ) : <button onClick={() => setEditing(true)} title={transaction.explanation}><CategoryBadge category={transaction.category} /></button>}
      </div>
      <span className={`confidence ${transaction.confidence < .8 ? "review" : ""}`}>{Math.round(transaction.confidence * 100)}%</span>
      <strong className={transaction.type === "credit" ? "amount credit" : "amount"}>{transaction.type === "credit" ? "+" : "−"}{money(transaction.amount)}</strong>
    </div>
  );
}

function SheetsModal({ connection, files, busy, permissionRequired, onClose, onAuthorize, onAction, onLoadFiles, onDisconnect }: {
  connection: SheetConnection | null;
  files: SheetFile[] | null;
  busy: boolean;
  permissionRequired: boolean;
  onClose: () => void;
  onAuthorize: () => void;
  onAction: (action: string, payload?: Record<string, string>) => void;
  onLoadFiles: (search?: string) => void;
  onDisconnect: (permanent: boolean) => void;
}) {
  const [name, setName] = useState(connection?.name || "Finora Financial Dashboard");
  const [search, setSearch] = useState("");
  const [folderId, setFolderId] = useState("");
  const [shareEmail, setShareEmail] = useState("");

  const normalizedFolderId = folderId.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] || folderId.trim();

  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal sheets-modal" onMouseDown={(event) => event.stopPropagation()}>
    <button className="modal-close" onClick={onClose} aria-label="Close Google Sheets"><X size={18}/></button>
    <div className="sheets-modal-heading"><span className="modal-icon"><FileSpreadsheet size={24}/></span><div><p className="eyebrow">GOOGLE SHEETS</p><h2>{connection ? "Your live money workbook" : "Create your Finora workbook"}</h2></div></div>
    <p>{connection ? "Your corrections, summaries, subscriptions, and charts stay connected to this workbook." : "Finora creates a private financial dashboard in your Google Drive and updates it whenever you choose."}</p>

    {permissionRequired && <div className="sheets-permission"><LockKeyhole size={18}/><div><strong>Google permission needed</strong><span>Approve access only to Sheets that Finora creates or you select.</span></div><button onClick={onAuthorize}>Continue with Google</button></div>}

    {!connection ? <>
      <label>Workbook name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120}/></label>
      <button className="modal-action" onClick={() => onAction("create", { name })} disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17}/>Creating tabs and charts…</> : <><FileSpreadsheet size={17}/>Create Finora Financial Dashboard</>}</button>
      <div className="sheets-divider"><span>or connect an accessible spreadsheet</span></div>
    </> : <div className="connected-sheet-card">
      <div><span><FileSpreadsheet size={20}/></span><div><strong>{connection.name}</strong><small>{connection.stale ? "New ledger changes are ready to sync" : `Last synced ${new Date(connection.lastSyncedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`}</small></div></div>
      <div><a href={connection.spreadsheetUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/>Open Sheet</a><button onClick={() => onAction("sync")} disabled={busy}><RefreshCw className={busy ? "spin" : ""} size={14}/>Sync again</button></div>
    </div>}

    <details className="sheet-picker" open={!connection}>
      <summary><Files size={14}/>Select another spreadsheet</summary>
      <div className="sheet-search"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Finora-accessible Sheets"/><button onClick={() => onLoadFiles(search)} disabled={busy}><Search size={14}/>Search</button></div>
      {files === null ? <button className="load-sheets-button" onClick={() => onLoadFiles()} disabled={busy}>Show accessible spreadsheets</button> : files.length ? <div className="sheet-file-list">{files.map((file) => <button key={file.id} onClick={() => onAction("connect", { spreadsheetId: file.id })} disabled={busy}><FileSpreadsheet size={16}/><span><strong>{file.name}</strong><small>{file.modifiedTime ? `Updated ${new Date(file.modifiedTime).toLocaleDateString("en-IN")}` : "Google Sheet"}</small></span><ChevronRight size={15}/></button>)}</div> : <div className="sheet-files-empty">No accessible spreadsheets found. Create one above or search by name.</div>}
    </details>

    {connection && <details className="sheet-management">
      <summary><MoreHorizontal size={15}/>Manage workbook</summary>
      <div className="sheet-manage-row"><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120}/><button onClick={() => onAction("rename", { name })} disabled={busy}><Pencil size={14}/>Rename</button><button onClick={() => onAction("copy", { name: `${name} copy` })} disabled={busy}><Copy size={14}/>Copy</button></div>
      <div className="sheet-manage-row"><input value={folderId} onChange={(event) => setFolderId(event.target.value)} placeholder="Drive folder URL or ID"/><button onClick={() => onAction("move", { folderId: normalizedFolderId })} disabled={busy || !normalizedFolderId}><Folder size={14}/>Move</button></div>
      <div className="sheet-manage-row"><input type="email" value={shareEmail} onChange={(event) => setShareEmail(event.target.value)} placeholder="Email to invite as editor"/><button onClick={() => onAction("share", { email: shareEmail })} disabled={busy || !shareEmail}><Share2 size={14}/>Share</button></div>
      <div className="sheet-danger-row"><button onClick={() => onDisconnect(false)} disabled={busy}><Unlink size={14}/>Disconnect from Finora</button><button onClick={() => onDisconnect(true)} disabled={busy}><Trash2 size={14}/>Delete workbook</button></div>
    </details>}

    <small className="privacy-note"><ShieldCheck size={12}/>Finora can only work with Sheets you create or explicitly connect.</small>
  </div></div>;
}

export default function Home() {
  const { data: session, isPending: sessionPending } = useSession();
  const [view, setView] = useState<View>("overview");
  const [statement, setStatement] = useState<StatementResult>(emptyStatement);
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState("Reading statement…");
  const [isDragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetConnection, setSheetConnection] = useState<SheetConnection | null>(null);
  const [sheetFiles, setSheetFiles] = useState<SheetFile[] | null>(null);
  const [sheetPermissionRequired, setSheetPermissionRequired] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [weeklyEmailEnabled, setWeeklyEmailEnabled] = useState(false);
  const [reportFrequency, setReportFrequency] = useState<"weekly" | "monthly">("weekly");
  const [reportTimezone, setReportTimezone] = useState("Asia/Kolkata");
  const [accountLoadedFor, setAccountLoadedFor] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [chatContextAttachments, setChatContextAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [newBudgetCategory, setNewBudgetCategory] = useState<Category>("Food & Dining");
  const [newBudgetLimit, setNewBudgetLimit] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatAttachmentsRef = useRef<ChatAttachment[]>([]);
  const chatContextAttachmentsRef = useRef<ChatAttachment[]>([]);
  const attachmentWorkRef = useRef<Promise<void> | null>(null);

  const activePeriod = useMemo(() => latestPeriod(statement.transactions), [statement]);
  const currentTransactions = useMemo(() => inPeriod(statement.transactions, activePeriod), [statement, activePeriod]);
  const summary = useMemo(() => summarize(currentTransactions), [currentTransactions]);
  const categoryEntries = useMemo(() => Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]), [summary]);
  const comparison = useMemo(() => compareMonths(statement.transactions, activePeriod), [statement, activePeriod]);
  const subscriptions = useMemo(() => detectSubscriptions(statement.transactions), [statement]);
  const duplicateMatches = useMemo(() => findDuplicateTransactions(statement.transactions), [statement]);
  const anomalies = useMemo(() => detectAnomalies(statement.transactions), [statement]);
  const budgetStatuses = useMemo(() => budgetStatus(statement.transactions, budgets, activePeriod), [statement, budgets, activePeriod]);
  const health = useMemo(() => financialHealthScore(statement.transactions, budgets), [statement, budgets]);
  const week = useMemo(() => weeklyReport(statement.transactions), [statement]);
  const weeklyReportDebits = useMemo(() => statement.transactions.filter((transaction) => transaction.type === "debit" && transaction.date.slice(0, 10) >= week.start && transaction.date.slice(0, 10) <= week.end), [statement, week.start, week.end]);
  const weeklyReportOutflow = useMemo(() => weeklyReportDebits.reduce((total, transaction) => total + transaction.amount, 0), [weeklyReportDebits]);
  const weeklyReportTransfers = useMemo(() => weeklyReportDebits.filter((transaction) => ["Transfers", "Investment"].includes(transaction.category)).reduce((total, transaction) => total + transaction.amount, 0), [weeklyReportDebits]);
  const weeklyTopCategory = useMemo(() => Object.entries(weeklyReportDebits.reduce<Record<string, number>>((acc, transaction) => { acc[transaction.category] = (acc[transaction.category] || 0) + transaction.amount; return acc; }, {})).sort((a, b) => b[1] - a[1])[0], [weeklyReportDebits]);
  const weeklyTopMerchant = useMemo(() => Object.entries(weeklyReportDebits.reduce<Record<string, number>>((acc, transaction) => { acc[transaction.merchant] = (acc[transaction.merchant] || 0) + transaction.amount; return acc; }, {})).sort((a, b) => b[1] - a[1])[0], [weeklyReportDebits]);
  const weeklyLargest = useMemo(() => [...weeklyReportDebits].sort((a, b) => b.amount - a.amount)[0], [weeklyReportDebits]);
  const reportDebits = useMemo(() => currentTransactions.filter((transaction) => transaction.type === "debit"), [currentTransactions]);
  const reportOutflow = useMemo(() => reportDebits.reduce((total, transaction) => total + transaction.amount, 0), [reportDebits]);
  const reportTopCategory = useMemo(() => Object.entries(reportDebits.reduce<Record<string, number>>((acc, transaction) => { acc[transaction.category] = (acc[transaction.category] || 0) + transaction.amount; return acc; }, {})).sort((a, b) => b[1] - a[1])[0], [reportDebits]);
  const reportTopMerchant = useMemo(() => Object.entries(reportDebits.reduce<Record<string, number>>((acc, transaction) => { acc[transaction.merchant] = (acc[transaction.merchant] || 0) + transaction.amount; return acc; }, {})).sort((a, b) => b[1] - a[1])[0], [reportDebits]);
  const reportLargest = useMemo(() => [...reportDebits].sort((a, b) => b.amount - a.amount)[0], [reportDebits]);
  const visibleTransactions = statement.transactions.filter((transaction) => `${transaction.merchant} ${transaction.description} ${transaction.category}`.toLowerCase().includes(search.toLowerCase()));
  const hasData = statement.transactions.length > 0;
  const userId = session?.user?.id;
  const accountLoading = Boolean(session?.user && accountLoadedFor !== session.user.id);
  const spendTrend = useMemo(() => {
    const daily = currentTransactions.filter((transaction) => transaction.type === "debit" && !["Transfers", "Investment"].includes(transaction.category)).reduce<Record<string, number>>((acc, transaction) => { const day = transaction.date.slice(0, 10); acc[day] = (acc[day] || 0) + transaction.amount; return acc; }, {});
    return Object.entries(daily).sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([, value]) => value);
  }, [currentTransactions]);
  const answer = chatMessages[chatMessages.length - 1]?.content || "Ask about a merchant, category, recurring charge, duplicate, or spending trend.";

  useEffect(() => {
    if (!sessionPending && !session?.user) window.location.replace("/");
  }, [sessionPending, session?.user]);

  useEffect(() => {
    if (view === "agent") chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatMessages, asking, view]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch("/api/account").then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load your account.");
      if (cancelled) return;
      setStatement(result.ledger?.statement || emptyStatement);
      setBudgets(result.ledger?.budgets || []);
      setWeeklyEmailEnabled(Boolean(result.preferences?.weeklyEmailEnabled));
      setReportFrequency(result.preferences?.frequency === "monthly" ? "monthly" : "weekly");
      setReportTimezone(result.preferences?.timezone || "Asia/Kolkata");
    }).catch((error) => !cancelled && notify(error instanceof Error ? error.message : "Could not load your account.", "bad"))
      .finally(() => !cancelled && setAccountLoadedFor(userId));
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch("/api/sheets").then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load Google Sheets.");
      if (cancelled) return;
      setSheetConnection(result.connection || null);
      setSynced(Boolean(result.connection && !result.connection.stale));
    }).catch((error) => !cancelled && notify(error instanceof Error ? error.message : "Could not load Google Sheets.", "bad"));
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetch("/api/chats").then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load chat history.");
      if (cancelled) return;
      const chats = Array.isArray(result.chats) ? result.chats as ChatThread[] : [];
      setChatThreads(chats);
      if (chats[0]) {
        const context = chats[0].attachmentContext || [];
        setActiveChatId(chats[0].id); setChatMessages(chats[0].messages);
        chatContextAttachmentsRef.current = context; setChatContextAttachments(context);
      }
    }).catch((error) => !cancelled && notify(error instanceof Error ? error.message : "Could not load chat history.", "bad"));
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!userId || params.get("gmail") !== "connected") return;
    const frequency = params.get("frequency") === "monthly" ? "monthly" : "weekly";
    window.history.replaceState({}, "", window.location.pathname);
    void fetch("/api/account", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: { weeklyEmailEnabled: true, frequency, timezone: reportTimezone } }) })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not enable AI reports."); setWeeklyEmailEnabled(true); setReportFrequency(frequency); setView("reports"); notify(`${frequency === "monthly" ? "Monthly" : "Weekly"} Gmail report enabled.`); })
      .catch((error) => notify(error instanceof Error ? error.message : "Could not enable weekly reports.", "bad"));
  }, [userId, reportTimezone]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!userId || params.get("sheets") !== "connected") return;
    const action = params.get("sheetAction") === "sync" ? "sync" : "create";
    window.history.replaceState({}, "", window.location.pathname);
    queueMicrotask(() => {
      setSheetOpen(true);
      setSheetPermissionRequired(false);
      void performSheetAction(action);
    });
  // The OAuth callback is consumed once when the signed-in user becomes available.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function notify(message: string, tone: "good" | "bad" = "good") {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 4200);
  }

  async function persistLedger(nextStatement: StatementResult, nextBudgets: Budget[]) {
    if (!session?.user) return;
    const response = await fetch("/api/account", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statement: nextStatement, budgets: nextBudgets }) });
    if (!response.ok) throw new Error("Your changes are visible here, but could not be saved to your account.");
  }

  async function savePreferences(enabled: boolean, timezone = reportTimezone, frequency: "weekly" | "monthly" = reportFrequency) {
    const response = await fetch("/api/account", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: { weeklyEmailEnabled: enabled, frequency, timezone } }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not update report settings.");
    setWeeklyEmailEnabled(enabled);
    setReportFrequency(frequency);
    setReportTimezone(timezone);
  }

  async function enableReport(frequency: "weekly" | "monthly" = reportFrequency) {
    if (!session?.user) return signIn.social({ provider: "google", callbackURL: "/dashboard" });
    await authClient.linkSocial({ provider: "google", scopes: ["https://www.googleapis.com/auth/gmail.send"], callbackURL: `/dashboard?gmail=connected&frequency=${frequency}` });
  }

  async function disableReport() {
    try { await savePreferences(false); notify("AI report emails are off."); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not update report settings.", "bad"); }
  }

  async function chooseReportFrequency(frequency: "weekly" | "monthly") {
    setReportFrequency(frequency);
    if (!weeklyEmailEnabled) return;
    try { await savePreferences(true, reportTimezone, frequency); notify(`${frequency === "monthly" ? "Monthly" : "Weekly"} delivery selected.`); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not update report frequency.", "bad"); }
  }

  async function clearLedger() {
    if (!window.confirm("Remove every imported transaction and budget from your Finora account? This cannot be undone.")) return;
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not clear your ledger.");
      setStatement(emptyStatement); setBudgets([]); setSynced(false); setAccountOpen(false); setView("overview");
      notify("Your imported ledger and budgets were removed.");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not clear your ledger.", "bad"); }
  }

  async function handleSignOut() {
    try {
      setAccountOpen(false);
      await signOut();
      setStatement(emptyStatement);
      setBudgets([]);
      setChatMessages([]);
      setChatThreads([]);
      chatAttachmentsRef.current = []; setChatAttachments([]);
      chatContextAttachmentsRef.current = []; setChatContextAttachments([]);
      setActiveChatId(null);
      setAccountLoadedFor(null);
      window.location.replace("/");
    } catch {
      notify("Could not sign out. Please try again.", "bad");
    }
  }

  function addBudget() {
    const limit = Number(newBudgetLimit);
    if (!Number.isFinite(limit) || limit <= 0) return notify("Enter a budget greater than zero.", "bad");
    const next = [...budgets.filter((budget) => budget.category !== newBudgetCategory), { category: newBudgetCategory, limit }];
    setBudgets(next); setNewBudgetLimit("");
    void persistLedger(statement, next).then(() => notify(`${newBudgetCategory} budget saved.`)).catch((error) => notify(error.message, "bad"));
  }

  function removeBudget(category: Category) {
    const next = budgets.filter((budget) => budget.category !== category);
    setBudgets(next);
    void persistLedger(statement, next).catch((error) => notify(error.message, "bad"));
  }

  async function parseFinancialFile(file: File, onProgress?: (label: string) => void): Promise<StatementResult> {
    if (file.size > 18 * 1024 * 1024) throw new Error(`${file.name} is larger than 18 MB.`);
    let text: string | undefined;
    let fileData: string | undefined;
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) text = await file.text();
    else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      onProgress?.("Normalizing spreadsheet…");
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.arrayBuffer());
      text = book.SheetNames.map((name) => `--- Sheet: ${name} ---\n${XLSX.utils.sheet_to_csv(book.Sheets[name])}`).join("\n\n");
    } else {
      fileData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
      });
    }
    onProgress?.("Finding transactions…");
    const response = await fetch("/api/categorize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, mimeType: file.type, fileData, text }) });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || `Could not read ${file.name}.`);
    return result as StatementResult;
  }

  async function handleChatFiles(fileList: FileList) {
    if (!session?.user) return notify("Sign in before attaching financial data.", "bad");
    const files = Array.from(fileList).slice(0, Math.max(0, 8 - chatAttachmentsRef.current.length));
    if (!files.length) return notify("You can attach up to 8 files per chat.", "bad");
    const pending = files.map<ChatAttachment>((file) => ({ id: crypto.randomUUID(), name: file.name, size: file.size, mimeType: file.type, transactionCount: 0, status: "reading" }));
    chatAttachmentsRef.current = [...chatAttachmentsRef.current, ...pending];
    setChatAttachments(chatAttachmentsRef.current);
    setAttachmentBusy(true);
    const work = (async () => {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index], id = pending[index].id;
        try {
          const parsed = await parseFinancialFile(file);
          chatAttachmentsRef.current = chatAttachmentsRef.current.map((attachment) => attachment.id === id ? { ...attachment, status: "ready", transactionCount: parsed.transactions.length, statement: parsed } : attachment);
          setChatAttachments(chatAttachmentsRef.current);
        } catch (error) {
          const message = error instanceof Error ? error.message : `Could not read ${file.name}.`;
          chatAttachmentsRef.current = chatAttachmentsRef.current.map((attachment) => attachment.id === id ? { ...attachment, status: "error", error: message } : attachment);
          setChatAttachments(chatAttachmentsRef.current);
        }
      }
    })();
    attachmentWorkRef.current = work;
    try { await work; }
    finally { if (attachmentWorkRef.current === work) attachmentWorkRef.current = null; setAttachmentBusy(false); }
  }

  async function handleFile(file?: File, append = false) {
    if (!file) return;
    if (!session?.user) return notify("Sign in before importing financial data.", "bad");
    if (file.size > 18 * 1024 * 1024) return notify("Please choose a statement under 18 MB.", "bad");
    setUploading(true);
    setUploadLabel("Reading every page…");
    try {
      let text: string | undefined;
      let fileData: string | undefined;
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
        text = await file.text();
      } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        setUploadLabel("Normalizing spreadsheet…");
        const XLSX = await import("xlsx");
        const book = XLSX.read(await file.arrayBuffer());
        text = XLSX.utils.sheet_to_csv(book.Sheets[book.SheetNames[0]]);
      } else {
        fileData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
        });
      }
      setUploadLabel("Finding transactions…");
      const response = await fetch("/api/categorize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, fileData, text }),
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Statement analysis failed.");
      const nextStatement = append ? { ...statement, transactions: [...result.transactions, ...statement.transactions], insights: [`Added ${result.transactions.length} receipt transaction${result.transactions.length === 1 ? "" : "s"}.`, ...statement.insights.slice(0, 2)] } : result;
      await persistLedger(nextStatement, budgets);
      setStatement(nextStatement);
      setSynced(false);
      setView("overview");
      notify(`${result.transactions.length} real transaction${result.transactions.length === 1 ? "" : "s"} imported and categorized.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "We couldn't read that statement.", "bad");
    } finally { setUploading(false); }
  }

  function updateCategory(id: string, category: Category) {
    const nextStatement = { ...statement, transactions: statement.transactions.map((transaction) => transaction.id === id ? { ...transaction, category, confidence: 1, explanation: "Category confirmed by you." } : transaction) };
    setStatement(nextStatement);
    void persistLedger(nextStatement, budgets).catch((error) => notify(error.message, "bad"));
    setSynced(false);
  }

  async function exportData(format: "csv" | "json" | "xlsx" | "markdown", sourceStatement = statement) {
    const header = ["Date", "Merchant", "Description", "Type", "Amount", "Category", "Confidence"];
    const sourcePeriod = latestPeriod(sourceStatement.transactions);
    const sourceSummary = summarize(inPeriod(sourceStatement.transactions, sourcePeriod));
    const sourceSubscriptions = detectSubscriptions(sourceStatement.transactions);
    const sourceAnomalies = detectAnomalies(sourceStatement.transactions);
    const sourceBudgetStatuses = budgetStatus(sourceStatement.transactions, budgets, sourcePeriod);
    const sourceHealth = financialHealthScore(sourceStatement.transactions, budgets);
    const sourceCategories = Object.entries(sourceSummary.byCategory).sort((a, b) => b[1] - a[1]);
    const rows = sourceStatement.transactions.map((t) => [t.date, t.merchant, t.description, t.type, t.amount, t.category, t.confidence]);
    if (format === "xlsx") {
      const XLSX = await import("xlsx"); const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, ...rows]), "Transactions");
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ Period: sourcePeriod, Income: sourceSummary.income, Spent: sourceSummary.spend, Saved: sourceSummary.saved, "Health score": sourceHealth.score }]), "Summary");
      XLSX.writeFile(book, "finora-report.xlsx"); notify("Excel workbook exported."); return;
    }
    const content = format === "json" ? JSON.stringify({ statement: sourceStatement, summary: sourceSummary, subscriptions: sourceSubscriptions, anomalies: sourceAnomalies, budgets: sourceBudgetStatuses, health: sourceHealth }, null, 2)
      : format === "markdown" ? `# Finora money report\n\n**Period:** ${sourcePeriod}\n\n- Income: ${money(sourceSummary.income)}\n- Spent: ${money(sourceSummary.spend)}\n- Saved: ${money(sourceSummary.saved)}\n- Health score: ${sourceHealth.score}/100\n\n## Categories\n${sourceCategories.map(([category, amount]) => `- ${category}: ${money(amount)}`).join("\n")}\n\n## Subscriptions\n${sourceSubscriptions.map((item) => `- ${item.merchant}: ${money(item.monthlyCost)}/month`).join("\n") || "None detected"}`
      : [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const mime = format === "json" ? "application/json" : format === "markdown" ? "text/markdown" : "text/csv";
    const url = URL.createObjectURL(new Blob([content], { type: mime })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `finora-report.${format === "markdown" ? "md" : format}`; anchor.click(); URL.revokeObjectURL(url); notify(`${format.toUpperCase()} report exported.`);
  }

  async function authorizeSheets(action = sheetConnection ? "sync" : "create") {
    await authClient.linkSocial({ provider: "google", scopes: ["https://www.googleapis.com/auth/drive.file"], callbackURL: `/dashboard?sheets=connected&sheetAction=${action}` });
  }

  async function loadSheetFiles(search = "") {
    setSyncing(true);
    try {
      const params = new URLSearchParams({ includeFiles: "1", ...(search ? { search } : {}) });
      const response = await fetch(`/api/sheets?${params}`);
      const result = await response.json();
      if (!response.ok) {
        if (result.permissionRequired) setSheetPermissionRequired(true);
        throw new Error(result.error || "Could not load Google Sheets.");
      }
      setSheetFiles(Array.isArray(result.files) ? result.files : []);
      setSheetPermissionRequired(false);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not load Google Sheets.", "bad"); }
    finally { setSyncing(false); }
  }

  async function performSheetAction(action: string, payload: Record<string, unknown> = {}, scopedStatement?: StatementResult): Promise<boolean> {
    setSyncing(true);
    try {
      const response = await fetch("/api/sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload, ...(scopedStatement ? { statement: scopedStatement } : {}) }) });
      const result = await response.json();
      if (!response.ok) {
        if (result.permissionRequired) {
          setSheetPermissionRequired(true);
          await authorizeSheets(action === "sync" ? "sync" : "create");
          return false;
        }
        throw new Error(result.error || "Google Sheets update failed.");
      }
      if (result.connection) setSheetConnection(result.connection);
      setSheetPermissionRequired(false);
      setSynced(true);
      if (action === "share") notify(`Workbook shared with ${String(payload.email || "the selected account")}.`);
      else if (action === "move") notify("Workbook moved to the selected Drive folder.");
      else if (action === "rename") notify("Workbook renamed.");
      else if (action === "copy") notify("A connected copy of your workbook was created.");
      else if (action === "connect") notify("Spreadsheet connected and updated with your Finora dashboard.");
      else if (action === "addTab") notify(`Added the ${String(payload.name || "new")} tab.`);
      else if (action === "deleteTab") notify(`Removed the ${String(payload.name || "selected")} tab.`);
      else if (action === "appendRows") notify(`Added rows to ${String(payload.tab || "the sheet")}.`);
      else if (action === "updateRange") notify(`Updated ${String(payload.range || "the selected range")}.`);
      else if (action === "clearRange") notify(`Cleared ${String(payload.range || "the selected range")}.`);
      else notify("Transactions, summaries, subscriptions, and charts are live in Google Sheets.");
      return true;
    } catch (error) { notify(error instanceof Error ? error.message : "Google Sheets update failed.", "bad"); return false; }
    finally { setSyncing(false); }
  }

  async function disconnectSheets(permanent: boolean) {
    const message = permanent ? "Permanently delete this Google Sheet? This cannot be undone." : "Disconnect this Sheet from Finora? The spreadsheet will remain in Google Drive.";
    if (!window.confirm(message)) return;
    setSyncing(true);
    try {
      const response = await fetch(`/api/sheets${permanent ? "?permanent=1" : ""}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not disconnect Google Sheets.");
      setSheetConnection(null); setSheetFiles(null); setSynced(false); setSheetOpen(false);
      notify(permanent ? "Google Sheet deleted." : "Google Sheet disconnected. The file remains in Drive.");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not disconnect Google Sheets.", "bad"); }
    finally { setSyncing(false); }
  }

  async function askAgent(prompt = question) {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || asking) return;
    setAsking(true);
    if (attachmentWorkRef.current) await attachmentWorkRef.current;
    const newAttachments = chatAttachmentsRef.current.filter((attachment) => attachment.status === "ready" && attachment.statement);
    if (chatAttachmentsRef.current.length && !newAttachments.length) { notify("Finora could not read the attached file. Remove it or attach a supported statement.", "bad"); setAsking(false); return; }
    const attachmentById = new Map([...chatContextAttachmentsRef.current, ...newAttachments].map((attachment) => [attachment.id, attachment]));
    const readyAttachments = [...attachmentById.values()];
    const newAttachmentMeta = newAttachments.map<ChatAttachmentMeta>(({ id, name, size, transactionCount }) => ({ id, name, size, transactionCount }));
    const attachmentMeta = readyAttachments.map<ChatAttachmentMeta>(({ id, name, size, transactionCount }) => ({ id, name, size, transactionCount }));
    const transactionKey = (transaction: Transaction) => `${transaction.date}|${transaction.merchant.toLowerCase()}|${transaction.type}|${transaction.amount}`;
    const attachmentTransactions: Transaction[] = [];
    const attachmentKeys = new Set<string>();
    for (const transaction of readyAttachments.flatMap((attachment) => attachment.statement?.transactions || [])) {
      const key = transactionKey(transaction);
      if (!attachmentKeys.has(key)) { attachmentTransactions.push(transaction); attachmentKeys.add(key); }
    }
    const combinedTransactions = [...statement.transactions];
    const known = new Set(combinedTransactions.map(transactionKey));
    for (const transaction of attachmentTransactions) {
      const key = transactionKey(transaction);
      if (!known.has(key)) { combinedTransactions.push(transaction); known.add(key); }
    }
    const asksForCombinedData = /\b(combine|combined|both|everything|all (?:my )?data)\b/i.test(cleanPrompt);
    const asksForSavedData = /\b(saved|imported|existing)\s+(?:ledger|transactions?|data)\b|\bmy\s+(?:saved\s+)?ledger\b/i.test(cleanPrompt);
    const evidenceScope: ChatMessage["evidenceScope"] = attachmentTransactions.length ? (asksForSavedData && !asksForCombinedData ? "ledger" : asksForCombinedData ? "combined" : "attachments") : "ledger";
    const analysisTransactions = evidenceScope === "attachments" ? attachmentTransactions : evidenceScope === "combined" ? combinedTransactions : statement.transactions;
    const analysisBudgets = evidenceScope === "attachments" ? [] : budgets;
    const scopedAttachmentMeta = evidenceScope === "ledger" ? [] : attachmentMeta;
    const history = chatMessages.slice(-10).map(({ role, content }) => ({ role, content }));
    const requestHistory = evidenceScope === "attachments" && newAttachmentMeta.length ? [] : history;
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: "user", content: cleanPrompt, ...(newAttachmentMeta.length ? { attachments: newAttachmentMeta } : {}) };
    const id = activeChatId || crypto.randomUUID();
    const existing = chatThreads.find((chat) => chat.id === id);
    const now = new Date().toISOString();
    const title = existing?.title || (cleanPrompt.length > 48 ? `${cleanPrompt.slice(0, 48).trim()}…` : cleanPrompt);
    const nextMessages = [...chatMessages, userMessage];
    const pendingThread: ChatThread = { id, title, messages: nextMessages, attachmentContext: readyAttachments, createdAt: existing?.createdAt || now, updatedAt: now };
    setActiveChatId(id);
    setChatMessages(nextMessages);
    setChatThreads((current) => [pendingThread, ...current.filter((chat) => chat.id !== id)]);
    void persistChat(pendingThread).catch((error) => notify(error instanceof Error ? error.message : "Could not save this chat.", "bad"));
    chatContextAttachmentsRef.current = readyAttachments;
    setChatContextAttachments(readyAttachments);
    chatAttachmentsRef.current = [];
    setChatAttachments([]);
    setQuestion("");
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: cleanPrompt, history: requestHistory, transactions: analysisTransactions, budgets: analysisBudgets, attachments: scopedAttachmentMeta, dataScope: evidenceScope, sheetConnected: Boolean(sheetConnection) }) });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Question failed.");
      const finalThread: ChatThread = { ...pendingThread, messages: [...nextMessages, { id: `assistant-${Date.now()}`, role: "assistant", content: result.answer, analysis: sanitizeAnalystResponse(result.analysis), actions: sanitizeAgentActions(result.actions), evidenceScope }], updatedAt: new Date().toISOString() };
      setChatMessages(finalThread.messages);
      setChatThreads((current) => [finalThread, ...current.filter((chat) => chat.id !== id)]);
      void persistChat(finalThread).catch((error) => notify(error instanceof Error ? error.message : "Could not save this chat.", "bad"));
    } catch {
      const analysis = buildAnalystResponse(cleanPrompt, analysisTransactions, analysisBudgets);
      const finalThread: ChatThread = { ...pendingThread, messages: [...nextMessages, { id: `assistant-${Date.now()}`, role: "assistant", content: analystMarkdown(analysis), analysis, actions: fallbackAgentActions(cleanPrompt, scopedAttachmentMeta.length), evidenceScope }], updatedAt: new Date().toISOString() };
      setChatMessages(finalThread.messages);
      setChatThreads((current) => [finalThread, ...current.filter((chat) => chat.id !== id)]);
      void persistChat(finalThread).catch((error) => notify(error instanceof Error ? error.message : "Could not save this chat.", "bad"));
    }
    finally { setAsking(false); }
  }

  async function persistChat(chat: ChatThread) {
    const response = await fetch("/api/chats", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: chat.id, title: chat.title, messages: chat.messages, attachmentContext: chat.attachmentContext || [] }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save this chat.");
  }

  async function replaceAttachmentContext(nextContext: ChatAttachment[]) {
    chatContextAttachmentsRef.current = nextContext;
    setChatContextAttachments(nextContext);
    if (!activeChatId) return;
    const current = chatThreads.find((chat) => chat.id === activeChatId);
    if (!current) return;
    const next = { ...current, attachmentContext: nextContext, updatedAt: new Date().toISOString() };
    setChatThreads((threads) => [next, ...threads.filter((chat) => chat.id !== next.id)]);
    await persistChat(next);
  }

  function updateActionState(messageId: string, actionId: string, status: AgentAction["status"], result?: string, save = true) {
    const messages = chatMessages.map((message) => message.id === messageId ? { ...message, actions: message.actions?.map((action) => action.id === actionId ? { ...action, status, ...(result ? { result } : {}) } : action) } : message);
    setChatMessages(messages);
    if (!activeChatId) return;
    const current = chatThreads.find((chat) => chat.id === activeChatId);
    if (!current) return;
    const next = { ...current, messages, attachmentContext: chatContextAttachmentsRef.current, updatedAt: new Date().toISOString() };
    setChatThreads((threads) => [next, ...threads.filter((chat) => chat.id !== next.id)]);
    if (save) void persistChat(next).catch((error) => notify(error instanceof Error ? error.message : "Could not save this action.", "bad"));
  }

  async function runAgentAction(messageId: string, action: AgentAction) {
    if (runningActionId || action.status === "completed") return;
    if (action.requiresConfirmation && !window.confirm(`${action.label}\n\n${action.description}\n\nRun this action now?`)) return;
    setRunningActionId(action.id);
    updateActionState(messageId, action.id, "running", "Working…", false);
    try {
      let result = "Completed.";
      const sourceMessage = chatMessages.find((message) => message.id === messageId);
      const actionScope = sourceMessage?.evidenceScope || "ledger";
      const attachmentOnly = actionScope === "attachments";
      const scopedStatement = actionScope === "ledger" ? undefined : statementFromAttachments(chatContextAttachmentsRef.current, actionScope === "combined" ? statement : undefined) || undefined;
      if (action.type === "import_attachments") {
        const incoming = [...chatContextAttachmentsRef.current, ...chatAttachmentsRef.current].filter((attachment) => attachment.status === "ready").flatMap((attachment) => attachment.statement?.transactions || []);
        if (!incoming.length) throw new Error("Attach at least one file with transactions first.");
        const signature = (transaction: Transaction) => `${transaction.date}|${transaction.merchant.toLowerCase()}|${transaction.type}|${transaction.amount}`;
        const known = new Set(statement.transactions.map(signature));
        const added = incoming.filter((transaction) => { const key = signature(transaction); if (known.has(key)) return false; known.add(key); return true; });
        const nextStatement = { ...statement, transactions: [...added, ...statement.transactions], insights: [`Added ${added.length} transaction${added.length === 1 ? "" : "s"} from Ask Finora attachments.`, ...statement.insights.slice(0, 2)] };
        await persistLedger(nextStatement, budgets); setStatement(nextStatement); setSynced(false);
        result = `${added.length} new transaction${added.length === 1 ? "" : "s"} added to your ledger.`;
      } else if (action.type === "recategorize_transactions") {
        if (!action.payload.merchant || !action.payload.category) throw new Error("A merchant and valid category are required.");
        const needle = action.payload.merchant.toLowerCase();
        let changed = 0;
        if (attachmentOnly) {
          const nextContext = chatContextAttachmentsRef.current.map((attachment) => attachment.statement ? { ...attachment, statement: { ...attachment.statement, transactions: attachment.statement.transactions.map((transaction) => `${transaction.merchant} ${transaction.description}`.toLowerCase().includes(needle) ? (changed += 1, { ...transaction, category: action.payload.category as Category, confidence: 1, explanation: "Updated through Ask Finora for this attached file." }) : transaction) } } : attachment);
          if (!changed) throw new Error(`No attached-file transactions matched ${action.payload.merchant}.`);
          await replaceAttachmentContext(nextContext); result = `${changed} attached-file transaction${changed === 1 ? "" : "s"} recategorized.`;
        } else {
          const nextStatement = { ...statement, transactions: statement.transactions.map((transaction) => `${transaction.merchant} ${transaction.description}`.toLowerCase().includes(needle) ? (changed += 1, { ...transaction, category: action.payload.category as Category, confidence: 1, explanation: "Updated through Ask Finora." }) : transaction) };
          if (!changed) throw new Error(`No transactions matched ${action.payload.merchant}.`);
          await persistLedger(nextStatement, budgets); setStatement(nextStatement); setSynced(false); result = `${changed} transaction${changed === 1 ? "" : "s"} recategorized.`;
        }
      } else if (action.type === "delete_transactions") {
        if (!action.payload.merchant) throw new Error("A specific merchant or person is required before deleting transactions.");
        const needle = action.payload.merchant.toLowerCase();
        if (attachmentOnly) {
          let removed = 0;
          const nextContext = chatContextAttachmentsRef.current.map((attachment) => attachment.statement ? { ...attachment, statement: { ...attachment.statement, transactions: attachment.statement.transactions.filter((transaction) => { const match = `${transaction.merchant} ${transaction.description}`.toLowerCase().includes(needle); if (match) removed += 1; return !match; }) } } : attachment);
          if (!removed) throw new Error(`No attached-file transactions matched ${action.payload.merchant}.`);
          await replaceAttachmentContext(nextContext); result = `${removed} matching attached-file transaction${removed === 1 ? "" : "s"} removed.`;
        } else {
          const removed = statement.transactions.filter((transaction) => `${transaction.merchant} ${transaction.description}`.toLowerCase().includes(needle));
          if (!removed.length) throw new Error(`No transactions matched ${action.payload.merchant}.`);
          const nextStatement = { ...statement, transactions: statement.transactions.filter((transaction) => !`${transaction.merchant} ${transaction.description}`.toLowerCase().includes(needle)) };
          await persistLedger(nextStatement, budgets); setStatement(nextStatement); setSynced(false); result = `${removed.length} matching transaction${removed.length === 1 ? "" : "s"} removed.`;
        }
      } else if (action.type === "add_transaction") {
        if (!action.payload.merchant || !action.payload.amount || !action.payload.direction) throw new Error("Merchant, amount, and debit/credit direction are required.");
        const transaction: Transaction = { id: crypto.randomUUID(), date: action.payload.date || new Date().toISOString().slice(0, 10), merchant: action.payload.merchant, description: action.payload.description || "Added through Ask Finora", amount: action.payload.amount, type: action.payload.direction, category: (action.payload.category as Category) || "Miscellaneous", confidence: 1, source: "Ask Finora", explanation: "Added and confirmed by you through Ask Finora." };
        if (attachmentOnly) {
          let added = false;
          const nextContext = chatContextAttachmentsRef.current.map((attachment) => !added && attachment.statement ? (added = true, { ...attachment, transactionCount: attachment.transactionCount + 1, statement: { ...attachment.statement, transactions: [transaction, ...attachment.statement.transactions] } }) : attachment);
          if (!added) throw new Error("This chat has no attached file to update.");
          await replaceAttachmentContext(nextContext); result = `${transaction.merchant} ${money(transaction.amount)} added to the attached-file context.`;
        } else {
          const nextStatement = { ...statement, transactions: [transaction, ...statement.transactions] };
          await persistLedger(nextStatement, budgets); setStatement(nextStatement); setSynced(false); result = `${transaction.merchant} ${money(transaction.amount)} added.`;
        }
      } else if (action.type === "sync_sheet" || action.type === "create_sheet") {
        const ok = await performSheetAction(action.type === "create_sheet" || !sheetConnection ? "create" : "sync", action.payload.name ? { name: action.payload.name } : {}, scopedStatement);
        if (!ok) throw new Error("Finish Google authorization, then run this action again.");
        result = sheetConnection ? `${scopedStatement ? "Attached-file" : "Saved-ledger"} data synced to Google Sheets.` : "Finora workbook created and connected.";
      } else if (action.type === "rename_sheet" || action.type === "copy_sheet" || action.type === "share_sheet" || action.type === "add_sheet_tab" || action.type === "delete_sheet_tab" || action.type === "append_sheet_rows" || action.type === "update_sheet_range" || action.type === "clear_sheet_range") {
        const request = action.type === "rename_sheet" ? ["rename", { name: action.payload.name }] : action.type === "copy_sheet" ? ["copy", { name: action.payload.name }] : action.type === "share_sheet" ? ["share", { email: action.payload.email }] : action.type === "add_sheet_tab" ? ["addTab", { name: action.payload.name || action.payload.tab }] : action.type === "delete_sheet_tab" ? ["deleteTab", { name: action.payload.name || action.payload.tab }] : action.type === "append_sheet_rows" ? ["appendRows", { tab: action.payload.tab, valuesJson: action.payload.valuesJson }] : action.type === "update_sheet_range" ? ["updateRange", { range: action.payload.range, valuesJson: action.payload.valuesJson }] : ["clearRange", { range: action.payload.range }];
        const ok = await performSheetAction(request[0] as string, request[1] as Record<string, string>);
        if (!ok) throw new Error("Google Sheets action could not be completed.");
        result = "Google Sheets updated.";
      } else if (action.type === "set_budget") {
        if (!action.payload.category || !action.payload.amount) throw new Error("A category and monthly limit are required.");
        const nextBudgets = [...budgets.filter((budget) => budget.category !== action.payload.category), { category: action.payload.category as Category, limit: action.payload.amount }];
        await persistLedger(statement, nextBudgets); setBudgets(nextBudgets); result = `${action.payload.category} budget set to ${money(action.payload.amount)}.`;
      } else if (action.type === "remove_budget") {
        if (!action.payload.category) throw new Error("A budget category is required.");
        const nextBudgets = budgets.filter((budget) => budget.category !== action.payload.category);
        await persistLedger(statement, nextBudgets); setBudgets(nextBudgets); result = `${action.payload.category} budget removed.`;
      } else if (action.type === "export_report") {
        const format = ["csv", "xlsx", "json", "markdown"].includes(action.payload.name.toLowerCase()) ? action.payload.name.toLowerCase() as "csv" | "xlsx" | "json" | "markdown" : "xlsx";
        await exportData(format, scopedStatement || statement); result = `${format === "xlsx" ? "Excel" : format.toUpperCase()} export downloaded.`;
      } else if (action.type === "open_reports") {
        setView("reports"); result = "AI Reports opened.";
      } else if (action.type === "schedule_report") {
        const frequency = action.payload.frequency || "weekly"; await enableReport(frequency); result = `${frequency === "monthly" ? "Monthly" : "Weekly"} report authorization started.`;
      }
      updateActionState(messageId, action.id, "completed", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "This action could not be completed.";
      updateActionState(messageId, action.id, "failed", message); notify(message, "bad");
    } finally { setRunningActionId(null); }
  }

  function startNewChat() {
    if (asking) return;
    if (!activeChatId && chatMessages.length) {
      const firstQuestion = chatMessages.find((message) => message.role === "user")?.content || "Finora conversation";
      const now = new Date().toISOString();
      const chat: ChatThread = { id: crypto.randomUUID(), title: firstQuestion.length > 48 ? `${firstQuestion.slice(0, 48).trim()}…` : firstQuestion, messages: chatMessages, attachmentContext: chatContextAttachmentsRef.current, createdAt: now, updatedAt: now };
      setChatThreads((current) => [chat, ...current]);
      void persistChat(chat).catch((error) => notify(error instanceof Error ? error.message : "Could not save this chat.", "bad"));
    }
    setActiveChatId(null);
    setChatMessages([]);
    chatAttachmentsRef.current = []; setChatAttachments([]);
    chatContextAttachmentsRef.current = []; setChatContextAttachments([]);
    setQuestion("");
  }

  function selectChat(chat: ChatThread) {
    if (asking) return;
    setActiveChatId(chat.id);
    setChatMessages(chat.messages);
    chatAttachmentsRef.current = []; setChatAttachments([]);
    const context = chat.attachmentContext || [];
    chatContextAttachmentsRef.current = context; setChatContextAttachments(context);
    setQuestion("");
  }

  async function deleteChat(chat: ChatThread) {
    if (asking || !window.confirm(`Delete “${chat.title}”?`)) return;
    const remaining = chatThreads.filter((item) => item.id !== chat.id);
    setChatThreads(remaining);
    if (activeChatId === chat.id) {
      setActiveChatId(remaining[0]?.id || null);
      setChatMessages(remaining[0]?.messages || []);
      chatAttachmentsRef.current = []; setChatAttachments([]);
      const context = remaining[0]?.attachmentContext || [];
      chatContextAttachmentsRef.current = context; setChatContextAttachments(context);
    }
    try {
      const response = await fetch(`/api/chats?id=${encodeURIComponent(chat.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not delete this chat.");
    } catch (error) {
      setChatThreads((current) => [chat, ...current]);
      notify(error instanceof Error ? error.message : "Could not delete this chat.", "bad");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={() => setView("overview")}><Mark /><span>finora</span></a>
        <nav className={menuOpen ? "main-nav open" : "main-nav"}>
          <button className={view === "overview" ? "active" : ""} onClick={() => { setView("overview"); setMenuOpen(false); }}><LayoutDashboard size={16}/>Overview</button>
          <button className={view === "transactions" ? "active" : ""} onClick={() => { setView("transactions"); setMenuOpen(false); }}><ReceiptIndianRupee size={16}/>Transactions</button>
          <button className={view === "reports" ? "active" : ""} onClick={() => { setView("reports"); setMenuOpen(false); }}><CalendarDays size={16}/>AI Reports</button>
          <div className={`sidebar-agent-section ${view === "agent" ? "expanded" : ""}`}>
            <div className="sidebar-agent-row">
              <button className={`sidebar-agent-entry ${view === "agent" ? "active" : ""}`} onClick={() => { setView("agent"); setMenuOpen(false); }}><Bot size={16}/><span>Ask Finora</span><span className="new-dot" /></button>
              <button className="sidebar-new-chat" onClick={() => { setView("agent"); startNewChat(); setMenuOpen(false); }} aria-label="Start a new Ask Finora chat" title="New chat"><Plus size={16}/></button>
            </div>
            {view === "agent" && <div className="sidebar-chat-history" aria-label="Ask Finora chat history">
              <div className="sidebar-chat-history-head"><span>RECENT CHATS</span><strong>{chatThreads.length}</strong></div>
              <div className="sidebar-chat-history-list">
                {chatThreads.map((chat) => <div className={`sidebar-chat-item ${chat.id === activeChatId ? "active" : ""}`} key={chat.id}>
                  <button onClick={() => { selectChat(chat); setMenuOpen(false); }}><MessageSquare size={13}/><span><strong>{chat.title}</strong><small>{new Date(chat.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {Math.ceil(chat.messages.length / 2)} repl{Math.ceil(chat.messages.length / 2) === 1 ? "y" : "ies"}</small></span></button>
                  <button onClick={() => deleteChat(chat)} aria-label={`Delete ${chat.title}`} title="Delete chat"><Trash2 size={13}/></button>
                </div>)}
                {chatThreads.length === 0 && <div className="sidebar-chat-empty"><MessageSquare size={17}/><span>Your conversations will appear here.</span></div>}
              </div>
            </div>}
          </div>
        </nav>
        <div className="top-actions">
          {session?.user && <button className="sheet-button" onClick={() => { setSheetOpen(true); setSheetFiles(null); }}>{synced ? <Check size={15}/> : <FileSpreadsheet size={16}/>}<span>{synced ? "Sheets synced" : sheetConnection ? "Sync Sheets" : "Connect Sheets"}</span></button>}
          {session?.user ? <button className="avatar" onClick={() => setAccountOpen(true)} aria-label="Account menu" title={session.user.email}>{session.user.image ? <img src={session.user.image} alt=""/> : session.user.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</button> : <Button variant="outline" size="sm" onClick={() => signIn.social({ provider: "google", callbackURL: "/dashboard" })} disabled={sessionPending}><UserRound size={15}/><span>Sign in</span></Button>}
          <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open menu"><Menu size={20}/></button>
        </div>
      </header>

      <section className="content-wrap">
        {view === "overview" && (sessionPending || accountLoading ? <WorkspaceSkeleton/> : !session?.user ? <EmptyWorkspace signedIn={false} uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/dashboard" })} onUpload={() => fileRef.current?.click()}/> : !hasData ? <EmptyWorkspace signedIn uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/dashboard" })} onUpload={() => fileRef.current?.click()}/> : <div className="overview-layout">
          <div className="welcome-row">
            <div><p className="eyebrow"><span className="live-dot" />MONEY SNAPSHOT · {statement.period.toUpperCase()}</p><h1>Your money,<br/><span>finally legible.</span></h1></div>
            <div className="source-card"><span className="bank-mark">{statement.bankName.slice(0, 1)}</span><span><small>Source</small><strong>{statement.bankName}</strong></span><BadgeCheck size={18}/></div>
          </div>

          <div className="metric-grid">
            <article className="metric-card spend-card"><div className="metric-label"><span>Spent · {activePeriod}</span>{comparison.spendChangePercent != null && <span className={`metric-chip ${comparison.spendChangePercent <= 0 ? "down" : "up"}`}>{comparison.spendChangePercent > 0 ? "↑" : "↓"} {Math.abs(comparison.spendChangePercent).toFixed(0)}% vs last</span>}</div><strong><NumberTicker value={summary.spend} formatter={money}/></strong><small>across {currentTransactions.filter((t) => t.type === "debit").length} payments</small><MiniTrend values={spendTrend}/></article>
            <article className="metric-card"><div className="metric-label"><span>Income</span><ArrowDownLeft size={17}/></div><strong><NumberTicker value={summary.income} formatter={money}/></strong><small>money in this period</small><div className="mini-bar"><i style={{ width: `${summary.income + summary.spend ? Math.min(100, summary.income / (summary.income + summary.spend) * 100) : 0}%` }}/></div></article>
            <article className="metric-card ink-card"><div className="metric-label"><span>Net cash flow</span><Sparkles size={17}/></div><strong><NumberTicker value={summary.saved} formatter={money}/></strong><small>{summary.income ? `${summary.savingsRate.toFixed(0)}% of income retained` : "No income detected in this period"}</small><span className={`good-pill ${summary.saved < 0 ? "negative" : ""}`}>{summary.saved >= 0 ? "Positive" : "Negative"}</span></article>
            <article className="metric-card safe-card"><div className="metric-label"><span>Average payment</span><CircleHelp size={17}/></div><strong><NumberTicker value={summary.spend / Math.max(1, currentTransactions.filter((t) => t.type === "debit" && !["Transfers", "Investment"].includes(t.category)).length)} formatter={money}/></strong><small>per consumption transaction</small><span className="scribble">from this ledger</span></article>
          </div>

          <article className={`panel dashboard-trend-panel ${spendTrend.length ? "" : "is-empty"}`}>
            <div className="dashboard-trend-head">
              <div><p className="eyebrow">SPENDING OVER TIME</p><h2>Your daily outflow</h2></div>
              <div className="trend-periods" aria-label="Selected chart period"><span>7D</span><span className="active">14D</span><span>30D</span></div>
            </div>
            {spendTrend.length ? <MiniTrend values={spendTrend} large/> : <div className="panel-empty"><Activity size={20}/><strong>No spending trend yet</strong><span>Import debit transactions to build this chart.</span></div>}
          </article>

          <div className="story-grid">
            <article className="panel category-panel">
              <div className="panel-head"><div><p className="eyebrow">WHERE IT WENT</p><h2>Spend by category</h2></div><button className="ghost-button" onClick={() => setView("transactions")}>See all <ChevronRight size={15}/></button></div>
              {categoryEntries.length ? <div className="category-story">
                <div className="donut" style={{ background: `conic-gradient(${categoryEntries.map(([category], index) => { const before = categoryEntries.slice(0, index).reduce((a, [, n]) => a + n, 0) / summary.spend * 100; const after = (categoryEntries.slice(0, index + 1).reduce((a, [, n]) => a + n, 0) / summary.spend) * 100; return `${categoryColors[category] || "#aaa"} ${before}% ${after}%`; }).join(",")})` }}><div><strong>{money(summary.spend)}</strong><span>total spent</span></div></div>
                <div className="category-list">{categoryEntries.slice(0, 6).map(([category, value]) => <div key={category}><span><i style={{ background: categoryColors[category] }}/>{category}</span><strong>{money(value)}</strong><div><i style={{ width: `${(value / (categoryEntries[0]?.[1] || 1)) * 100}%`, background: categoryColors[category] }}/></div></div>)}</div>
              </div> : <div className="panel-empty"><ReceiptIndianRupee size={20}/><strong>No spending in this period</strong><span>The imported ledger currently contains only income or transfers.</span></div>}
            </article>

            <article className="panel insight-panel">
              <div className="insight-title"><span><Zap size={18}/></span><div><p className="eyebrow">FINORA NOTICED</p><h2>Worth your attention</h2></div></div>
              <div className="insight-list">{statement.insights.map((insight, index) => <div className="insight" key={insight}><span>{index + 1}</span><p>{insight}</p></div>)}</div>
              <button className="ask-button" onClick={() => setView("agent")}><Sparkles size={16}/>Ask a follow-up<ChevronRight size={15}/></button>
            </article>
          </div>

          <div className="intelligence-grid">
            <article className="panel health-panel">
              <div className="feature-head"><span><Gauge size={18}/></span><div><p className="eyebrow">FINANCIAL HEALTH</p><h2>{health.score}<small>/100</small> · {health.label}</h2></div></div>
              <div className="score-track"><i style={{ width: `${health.score}%` }}/></div>
              <div className="score-breakdown">{Object.entries(health.breakdown).map(([label, value]) => <span key={label}><strong>{value}</strong>{label}</span>)}</div>
            </article>
            <article className="panel subscription-panel">
              <div className="feature-head"><span><Repeat2 size={18}/></span><div><p className="eyebrow">SUBSCRIPTIONS</p><h2>{money(subscriptions.reduce((a, item) => a + item.monthlyCost, 0))}<small>/month</small></h2></div></div>
              <div className="subscription-list">{subscriptions.slice(0, 3).map((item) => <div key={item.merchant}><span><strong>{item.merchant}</strong><small>Renews ~{new Date(item.estimatedRenewalDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</small></span><strong>{money(item.monthlyCost)}</strong></div>)}</div>
              <small className="annual-note">{subscriptions.length ? `${money(subscriptions.reduce((a, item) => a + item.annualCost, 0))} estimated annually` : "No recurring cadence detected yet."}</small>
            </article>
            <article className="panel risk-panel">
              <div className="feature-head"><span><ShieldCheck size={18}/></span><div><p className="eyebrow">SMART REVIEW</p><h2>{duplicateMatches.length + anomalies.length} item{duplicateMatches.length + anomalies.length === 1 ? "" : "s"} to check</h2></div></div>
              {duplicateMatches[0] && <div className="risk-item"><CopyCheck size={16}/><span><strong>Possible duplicate</strong><small>{duplicateMatches[0].merchant} · {money(duplicateMatches[0].amount)} · {duplicateMatches[0].minutesApart} min apart</small></span></div>}
              {anomalies.slice(0, duplicateMatches.length ? 1 : 2).map((item) => <div className="risk-item" key={item.id}><Activity size={16}/><span><strong>{item.title}</strong><small>{item.detail}</small></span></div>)}
              {!duplicateMatches.length && !anomalies.length && <div className="risk-clear"><Check size={15}/><span><strong>No issues detected</strong><small>Based on the transactions currently imported.</small></span></div>}
            </article>
          </div>

          <div className="planning-grid">
            <article className="panel budget-panel">
              <div className="panel-head"><div><p className="eyebrow">BUDGET PULSE</p><h2>Stay ahead, category by category</h2></div><span className="ai-label">Editable limits</span></div>
              <div className="budget-list">
                {budgetStatuses.length === 0 && <div className="budget-empty"><strong>No budgets yet</strong><span>Add only the limits you actually want Finora to track.</span></div>}
                {budgetStatuses.map((item) => <div className={`budget-row ${item.status}`} key={item.category}><div><strong>{item.category}</strong><span>{money(item.spent)} of {money(item.limit)}</span></div><div className="budget-track"><i style={{ width: `${Math.min(100, item.usedPercent)}%` }}/></div><strong>{item.usedPercent.toFixed(0)}%</strong><button onClick={() => removeBudget(item.category as Category)} aria-label={`Remove ${item.category} budget`}><Trash2 size={13}/></button></div>)}
                <div className="budget-create"><select value={newBudgetCategory} onChange={(event) => setNewBudgetCategory(event.target.value as Category)}>{categories.filter((category) => !["Salary", "Income", "Transfers", "Investment"].includes(category)).map((category) => <option key={category}>{category}</option>)}</select><label><span>₹</span><input type="number" min="1" value={newBudgetLimit} onChange={(event) => setNewBudgetLimit(event.target.value)} placeholder="Monthly limit"/></label><Button size="sm" variant="outline" onClick={addBudget}><Plus size={14}/>Add</Button></div>
              </div>
            </article>
            <article className="panel weekly-panel">
              <div className="feature-head"><span><CalendarDays size={18}/></span><div><p className="eyebrow">WEEKLY AI REPORT</p><h2>{money(week.spent)} spent</h2></div></div>
              <div className="weekly-facts"><span><small>Largest category</small><strong>{week.topCategory}</strong></span><span><small>Largest merchant</small><strong>{week.topMerchant}</strong></span><span><small>Biggest expense</small><strong>{week.largestExpense ? `${week.largestExpense.merchant} · ${money(week.largestExpense.amount)}` : "None"}</strong></span></div>
              <p>{week.suggestion}</p>
              <button className="weekly-email-button" onClick={() => setView("reports")}><Mail size={15}/>{weeklyEmailEnabled ? `${reportFrequency === "monthly" ? "Monthly" : "Weekly"} Gmail report is on` : "Choose your AI report schedule"}</button>
            </article>
          </div>

          <div className="lower-grid">
            <article className="panel recent-panel">
              <div className="panel-head"><div><p className="eyebrow">FRESHLY SORTED</p><h2>Recent transactions</h2></div></div>
              <div className="transaction-table compact"><div className="transaction-head"><span>Merchant</span><span>Date</span><span>Category</span><span>Confidence</span><span>Amount</span></div>{currentTransactions.slice(0, 5).map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} onCategory={(category) => updateCategory(transaction.id, category)} />)}</div>
              <button className="full-row-button" onClick={() => setView("transactions")}>View all {statement.transactions.length} transactions <ChevronRight size={15}/></button>
            </article>

            <article className={`upload-card ${isDragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); handleFile(event.dataTransfer.files[0]); }}>
              <div className="upload-icon"><UploadCloud size={25}/></div>
              <p className="eyebrow">ADD ANOTHER ACCOUNT</p><h2>Drop any statement.</h2><p>PDF, CSV, XLSX, scanned image — from any bank or UPI app.</p>
              <button onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <><LoaderCircle className="spin" size={17}/>{uploadLabel}</> : <><FileText size={17}/>Choose statement</>}</button>
              <small><LockKeyhole size={12}/>Encrypted in transit · raw file is not stored</small>
              <BorderBeam/>
            </article>
          </div>
        </div>)}

        {view === "transactions" && (sessionPending || accountLoading ? <WorkspaceSkeleton/> : !session?.user ? <EmptyWorkspace signedIn={false} uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/dashboard" })} onUpload={() => fileRef.current?.click()}/> : !hasData ? <EmptyWorkspace signedIn uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/dashboard" })} onUpload={() => fileRef.current?.click()}/> : <section className="view-page">
          <div className="view-heading"><div><p className="eyebrow">YOUR CLEAN LEDGER</p><h1>Transactions</h1><p>{statement.transactions.length} payments from {statement.bankName}. Click any category to correct it.</p></div><div className="view-actions"><details className="export-menu"><summary>Export <ChevronDown size={15}/></summary><div><button onClick={(event) => { void exportData("csv"); event.currentTarget.closest("details")?.removeAttribute("open"); }}>CSV <small>Comma-separated</small></button><button onClick={(event) => { void exportData("xlsx"); event.currentTarget.closest("details")?.removeAttribute("open"); }}>Excel <small>Workbook</small></button><button onClick={(event) => { void exportData("json"); event.currentTarget.closest("details")?.removeAttribute("open"); }}>JSON <small>Structured data</small></button><button onClick={(event) => { void exportData("markdown"); event.currentTarget.closest("details")?.removeAttribute("open"); }}>Markdown <small>Readable report</small></button></div></details><button className="secondary-button" onClick={() => receiptRef.current?.click()}><Camera size={16}/>Scan receipt</button><button className="primary-button" onClick={() => fileRef.current?.click()}><UploadCloud size={16}/>Import statement</button></div></div>
          <div className="filter-bar"><label><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search merchant, narration, category…"/></label><span>{visibleTransactions.length} result{visibleTransactions.length === 1 ? "" : "s"}</span></div>
          <div className="panel ledger-panel"><div className="transaction-table"><div className="transaction-head"><span>Merchant</span><span>Date</span><span>Category</span><span>Confidence</span><span>Amount</span></div>{visibleTransactions.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} onCategory={(category) => updateCategory(transaction.id, category)} />)}</div></div>
        </section>)}

        {view === "reports" && (sessionPending || accountLoading ? <WorkspaceSkeleton/> : !session?.user ? <EmptyWorkspace signedIn={false} uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/dashboard" })} onUpload={() => fileRef.current?.click()}/> : !hasData ? <EmptyWorkspace signedIn uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/dashboard" })} onUpload={() => fileRef.current?.click()}/> : <ReportsPage frequency={reportFrequency} enabled={weeklyEmailEnabled} timezone={reportTimezone} period={reportFrequency === "weekly" ? `${week.start} — ${week.end}` : activePeriod} outflow={reportFrequency === "weekly" ? weeklyReportOutflow : reportOutflow} consumption={reportFrequency === "weekly" ? weeklyReportOutflow - weeklyReportTransfers : summary.spend} transfers={reportFrequency === "weekly" ? weeklyReportTransfers : summary.transfers} topCategory={(reportFrequency === "weekly" ? weeklyTopCategory : reportTopCategory)?.[0] || "None"} topMerchant={(reportFrequency === "weekly" ? weeklyTopMerchant : reportTopMerchant)?.[0] || "None"} largest={reportFrequency === "weekly" ? (weeklyLargest ? `${weeklyLargest.merchant} · ${money(weeklyLargest.amount)}` : "None") : (reportLargest ? `${reportLargest.merchant} · ${money(reportLargest.amount)}` : "None")} healthScore={health.score} healthLabel={health.label} suggestion={reportFrequency === "weekly" ? week.suggestion : (statement.insights[0] || "Keep importing transactions to receive a useful monthly suggestion.")} onFrequency={(frequency) => void chooseReportFrequency(frequency)} onTimezone={(timezone) => { setReportTimezone(timezone); if (weeklyEmailEnabled) void savePreferences(true, timezone, reportFrequency); }} onEnable={() => void enableReport()} onDisable={() => void disableReport()}/>) }

        {view === "agent" && (sessionPending || accountLoading ? <WorkspaceSkeleton/> : !session?.user ? <EmptyWorkspace signedIn={false} uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/dashboard" })} onUpload={() => fileRef.current?.click()}/> : <ChatWorkspace messages={chatMessages} question={question} asking={asking} transactionCount={statement.transactions.length} attachments={chatAttachments} contextAttachments={chatContextAttachments} attachmentBusy={attachmentBusy} runningActionId={runningActionId} onQuestion={setQuestion} onAsk={askAgent} onAttach={(files) => void handleChatFiles(files)} onRemoveAttachment={(id) => { chatAttachmentsRef.current = chatAttachmentsRef.current.filter((attachment) => attachment.id !== id); setChatAttachments(chatAttachmentsRef.current); }} onRunAction={(messageId, action) => void runAgentAction(messageId, action)} endRef={chatEndRef}/>)}

        {false && view === "agent" && (sessionPending || accountLoading ? <WorkspaceSkeleton/> : !session?.user ? <EmptyWorkspace signedIn={false} uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/dashboard" })} onUpload={() => fileRef.current?.click()}/> : !hasData ? <EmptyWorkspace signedIn uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/dashboard" })} onUpload={() => fileRef.current?.click()}/> : <section className="agent-page">
          <div className="agent-copy"><p className="eyebrow"><span className="live-dot"/>YOUR FINANCIAL COPILOT</p><h1>Ask your money<br/>a real question.</h1><p>Finora gives your agent a clean financial memory through MCP — not a screenshot, not a vague guess.</p><div className="agent-proof"><span><Check size={14}/>Reads your corrected categories</span><span><Check size={14}/>Answers from transaction evidence</span><span><Check size={14}/>Works inside Codex</span></div></div>
          <div className="agent-console">
            <div className="console-head"><div><Mark/><span><strong>Finora agent</strong><small><i/>MCP connected · {statement.transactions.length} transactions</small></span></div><MoreHorizontal size={19}/></div>
            <div className="chat-body"><div className="bot-message"><span>{asking ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>}</span><p>{asking ? "Reading your ledger…" : answer}</p></div><div className="suggestion-grid">{["Where did I waste the most?", "Which merchant charged me twice?", "Show subscriptions", "Compare June vs July", "What's my average daily spending?", "How is my budget doing?"].map((prompt) => <button key={prompt} onClick={() => askAgent(prompt)}>{prompt}<ChevronRight size={14}/></button>)}</div></div>
            <form className="ask-form" onSubmit={(event) => { event.preventDefault(); askAgent(); }}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about your money…"/><button aria-label="Ask Finora"><ArrowUpRight size={18}/></button></form>
            <div className="console-foot"><code>finora.get_spending_summary</code><span>Evidence-backed</span></div>
          </div>
        </section>)}
      </section>

      <input ref={fileRef} type="file" accept=".pdf,.csv,.tsv,.txt,.xlsx,.xls,image/png,image/jpeg" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void handleFile(file); }}/>
      <input ref={receiptRef} type="file" accept="image/png,image/jpeg,.pdf" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void handleFile(file, true); }}/>
      {sheetOpen && <SheetsModal key={sheetConnection?.spreadsheetId || "new-sheet"} connection={sheetConnection} files={sheetFiles} busy={syncing} permissionRequired={sheetPermissionRequired} onClose={() => setSheetOpen(false)} onAuthorize={() => void authorizeSheets()} onAction={(action, payload) => void performSheetAction(action, payload)} onLoadFiles={(query) => void loadSheetFiles(query)} onDisconnect={(permanent) => void disconnectSheets(permanent)}/>}

      {accountOpen && session?.user && <div className="modal-backdrop" onMouseDown={() => setAccountOpen(false)}><div className="modal account-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={() => setAccountOpen(false)}><X size={18}/></button>
        <div className="account-person">{session.user.image ? <img src={session.user.image} alt=""/> : <span><UserRound size={22}/></span>}<div><p className="eyebrow">FINORA ACCOUNT</p><h2>{session.user.name}</h2><small>{session.user.email}</small></div></div>
        <div className="report-setting"><span className="modal-icon"><Mail size={22}/></span><div><h3>{reportFrequency === "monthly" ? "Monthly" : "Weekly"} money story</h3><p>Finora sends your total outflow, category and merchant highlights, health score, subscriptions, and one useful suggestion to this Gmail address.</p></div></div>
        <label>Report timezone<select value={reportTimezone} onChange={(event) => { setReportTimezone(event.target.value); if (weeklyEmailEnabled) void savePreferences(true, event.target.value, reportFrequency); }}><option value="Asia/Kolkata">India · Asia/Kolkata</option><option value="America/New_York">US · New York</option><option value="America/Los_Angeles">US · Los Angeles</option><option value="Europe/London">UK · London</option><option value="Asia/Singapore">Singapore</option></select></label>
        {weeklyEmailEnabled ? <button className="modal-action report-off" onClick={disableReport}><Mail size={16}/>Turn off AI report email</button> : <button className="modal-action" onClick={() => void enableReport()}><Mail size={16}/>Allow Gmail & enable report</button>}
        <small className="privacy-note"><ShieldCheck size={12}/>Finora can send this report, but cannot read your inbox.</small>
        {hasData && <button className="clear-data-link" onClick={clearLedger}><Trash2 size={14}/>Clear imported data</button>}
        <button className="sign-out-link" onClick={handleSignOut}><LogOut size={15}/>Sign out</button>
        {accountLoading && <div className="account-loading"><LoaderCircle className="spin" size={18}/></div>}
      </div></div>}

      {toast && <div className={`toast ${toast.tone}`}><span>{toast.tone === "good" ? <Check size={15}/> : <AlertCircle size={15}/>}</span>{toast.message}</div>}
    </main>
  );
}
