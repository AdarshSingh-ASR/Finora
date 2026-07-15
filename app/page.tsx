"use client";
/* Google OAuth avatars are remote user content, so they intentionally use the native img element. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, ArrowDownLeft, ArrowUpRight, BadgeCheck, Bot, CalendarDays,
  Camera, Check, ChevronRight, CircleHelp, Cloud, CopyCheck, FileSpreadsheet,
  FileText, Gauge, LayoutDashboard, LoaderCircle, LockKeyhole, Menu, MoreHorizontal,
  ReceiptIndianRupee, Repeat2, Search, ShieldCheck, Sparkles, UploadCloud,
  X, Zap, LogOut, Mail, UserRound, Plus, Trash2, Database, ArrowRight,
} from "lucide-react";
import { answerFinanceQuestion, budgetStatus, categories, compareMonths, detectAnomalies, detectSubscriptions, financialHealthScore, findDuplicateTransactions, inPeriod, latestPeriod, money, summarize, weeklyReport } from "../lib/finance";
import { categoryColors } from "../lib/category-colors";
import type { Budget, Category, StatementResult, Transaction } from "../lib/types";
import { authClient, signIn, signOut, useSession } from "../lib/auth-client";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { NumberTicker } from "../components/magicui/number-ticker";
import { BorderBeam } from "../components/magicui/border-beam";

type View = "overview" | "transactions" | "agent";
type Toast = { tone: "good" | "bad"; message: string } | null;

const emptyStatement: StatementResult = { accountName: "", bankName: "", period: "", currency: "INR", transactions: [], insights: [] };

function MiniTrend({ values }: { values: number[] }) {
  if (!values.length) return null;
  const maximum = Math.max(...values, 1), denominator = Math.max(1, values.length - 1);
  const points = values.map((value, index) => `${(index / denominator) * 100},${70 - (value / maximum) * 54}`).join(" ");
  return (
    <svg className="trend-chart" viewBox="0 0 100 75" preserveAspectRatio="none" aria-label="Spending trend">
      <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#275dff" stopOpacity=".24"/><stop offset="1" stopColor="#275dff" stopOpacity="0"/></linearGradient></defs>
      <path d={`M0,75 L${points} L100,75 Z`} fill="url(#area)" />
      <polyline points={points} fill="none" stroke="#275dff" strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
  const [webhookUrl, setWebhookUrl] = useState("");
  const [sheetSecret, setSheetSecret] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [weeklyEmailEnabled, setWeeklyEmailEnabled] = useState(false);
  const [reportTimezone, setReportTimezone] = useState("Asia/Kolkata");
  const [accountLoadedFor, setAccountLoadedFor] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("Ask about a merchant, category, recurring charge, duplicate, or spending trend.");
  const [asking, setAsking] = useState(false);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [newBudgetCategory, setNewBudgetCategory] = useState<Category>("Food & Dining");
  const [newBudgetLimit, setNewBudgetLimit] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);

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
  const visibleTransactions = statement.transactions.filter((transaction) => `${transaction.merchant} ${transaction.description} ${transaction.category}`.toLowerCase().includes(search.toLowerCase()));
  const hasData = statement.transactions.length > 0;
  const userId = session?.user?.id;
  const accountLoading = Boolean(session?.user && accountLoadedFor !== session.user.id);
  const spendTrend = useMemo(() => {
    const daily = currentTransactions.filter((transaction) => transaction.type === "debit" && !["Transfers", "Investment"].includes(transaction.category)).reduce<Record<string, number>>((acc, transaction) => { const day = transaction.date.slice(0, 10); acc[day] = (acc[day] || 0) + transaction.amount; return acc; }, {});
    return Object.entries(daily).sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([, value]) => value);
  }, [currentTransactions]);

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
      setReportTimezone(result.preferences?.timezone || "Asia/Kolkata");
    }).catch((error) => !cancelled && notify(error instanceof Error ? error.message : "Could not load your account.", "bad"))
      .finally(() => !cancelled && setAccountLoadedFor(userId));
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!userId || new URLSearchParams(window.location.search).get("gmail") !== "connected") return;
    window.history.replaceState({}, "", window.location.pathname);
    void fetch("/api/account", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: { weeklyEmailEnabled: true, timezone: reportTimezone } }) })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not enable weekly reports."); setWeeklyEmailEnabled(true); notify("Weekly Gmail report enabled. Your first report will arrive Sunday."); })
      .catch((error) => notify(error instanceof Error ? error.message : "Could not enable weekly reports.", "bad"));
  }, [userId, reportTimezone]);

  function notify(message: string, tone: "good" | "bad" = "good") {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 4200);
  }

  async function persistLedger(nextStatement: StatementResult, nextBudgets: Budget[]) {
    if (!session?.user) return;
    const response = await fetch("/api/account", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statement: nextStatement, budgets: nextBudgets }) });
    if (!response.ok) throw new Error("Your changes are visible here, but could not be saved to your account.");
  }

  async function savePreferences(enabled: boolean, timezone = reportTimezone) {
    const response = await fetch("/api/account", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: { weeklyEmailEnabled: enabled, timezone } }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not update report settings.");
    setWeeklyEmailEnabled(enabled);
    setReportTimezone(timezone);
  }

  async function enableWeeklyEmail() {
    if (!session?.user) return signIn.social({ provider: "google", callbackURL: "/" });
    await authClient.linkSocial({ provider: "google", scopes: ["https://www.googleapis.com/auth/gmail.send"], callbackURL: "/?gmail=connected" });
  }

  async function disableWeeklyEmail() {
    try { await savePreferences(false); notify("Weekly Gmail reports are off."); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not update report settings.", "bad"); }
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
      setUploadLabel("Finding transactions with Gemini 2.5 Flash…");
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
      notify(`${result.transactions.length} real transaction${result.transactions.length === 1 ? "" : "s"} imported ${result.provider === "local" ? "with local parsing" : `and categorized by ${result.provider === "groq" ? "Groq" : "Gemini"}`}.`);
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

  async function exportData(format: "csv" | "json" | "xlsx" | "markdown") {
    const header = ["Date", "Merchant", "Description", "Type", "Amount", "Category", "Confidence"];
    const rows = statement.transactions.map((t) => [t.date, t.merchant, t.description, t.type, t.amount, t.category, t.confidence]);
    if (format === "xlsx") {
      const XLSX = await import("xlsx"); const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, ...rows]), "Transactions");
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ Period: activePeriod, Income: summary.income, Spent: summary.spend, Saved: summary.saved, "Health score": health.score }]), "Summary");
      XLSX.writeFile(book, "finora-report.xlsx"); notify("Excel workbook exported."); return;
    }
    const content = format === "json" ? JSON.stringify({ statement, summary, subscriptions, anomalies, budgets: budgetStatuses, health }, null, 2)
      : format === "markdown" ? `# Finora money report\n\n**Period:** ${activePeriod}\n\n- Income: ${money(summary.income)}\n- Spent: ${money(summary.spend)}\n- Saved: ${money(summary.saved)}\n- Health score: ${health.score}/100\n\n## Categories\n${categoryEntries.map(([category, amount]) => `- ${category}: ${money(amount)}`).join("\n")}\n\n## Subscriptions\n${subscriptions.map((item) => `- ${item.merchant}: ${money(item.monthlyCost)}/month`).join("\n") || "None detected"}`
      : [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const mime = format === "json" ? "application/json" : format === "markdown" ? "text/markdown" : "text/csv";
    const url = URL.createObjectURL(new Blob([content], { type: mime })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `finora-report.${format === "markdown" ? "md" : format}`; anchor.click(); URL.revokeObjectURL(url); notify(`${format.toUpperCase()} report exported.`);
  }

  async function syncSheets() {
    if (!webhookUrl) return notify("Paste your Apps Script web app URL first.", "bad");
    setSyncing(true);
    try {
      const response = await fetch("/api/sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ webhookUrl, secret: sheetSecret, statement }) });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Sync failed.");
      setSynced(true); setSheetOpen(false); notify("Summary, ledger, and charts are live in Google Sheets.");
      if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) { notify(error instanceof Error ? error.message : "Sheets sync failed.", "bad"); }
    finally { setSyncing(false); }
  }

  async function askAgent(prompt = question) {
    if (!prompt.trim()) return;
    setQuestion(prompt);
    setAsking(true);
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: prompt, transactions: statement.transactions, budgets }) });
      const result = await response.json(); if (!response.ok || result.error) throw new Error(result.error || "Question failed."); setAnswer(result.answer);
    } catch { setAnswer(answerFinanceQuestion(prompt, statement.transactions, budgets)); }
    finally { setAsking(false); }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={() => setView("overview")}><Mark /><span>finora</span><em>beta</em></a>
        <nav className={menuOpen ? "main-nav open" : "main-nav"}>
          <button className={view === "overview" ? "active" : ""} onClick={() => { setView("overview"); setMenuOpen(false); }}><LayoutDashboard size={16}/>Overview</button>
          <button className={view === "transactions" ? "active" : ""} onClick={() => { setView("transactions"); setMenuOpen(false); }}><ReceiptIndianRupee size={16}/>Transactions</button>
          <button className={view === "agent" ? "active" : ""} onClick={() => { setView("agent"); setMenuOpen(false); }}><Bot size={16}/>Ask Finora <span className="new-dot" /></button>
        </nav>
        <div className="top-actions">
          {session?.user && hasData && <button className="sheet-button" onClick={() => setSheetOpen(true)}>{synced ? <Check size={15}/> : <FileSpreadsheet size={16}/>}<span>{synced ? "Synced" : "Sync Sheets"}</span></button>}
          {session?.user ? <button className="avatar" onClick={() => setAccountOpen(true)} aria-label="Account menu" title={session.user.email}>{session.user.image ? <img src={session.user.image} alt=""/> : session.user.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</button> : <Button variant="outline" size="sm" onClick={() => signIn.social({ provider: "google", callbackURL: "/" })} disabled={sessionPending}><UserRound size={15}/><span>Sign in</span></Button>}
          <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open menu"><Menu size={20}/></button>
        </div>
      </header>

      <section className="content-wrap">
        {view === "overview" && (sessionPending || accountLoading ? <WorkspaceSkeleton/> : !session?.user ? <EmptyWorkspace signedIn={false} uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/" })} onUpload={() => fileRef.current?.click()}/> : !hasData ? <EmptyWorkspace signedIn uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/" })} onUpload={() => fileRef.current?.click()}/> : <>
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
              <button className="weekly-email-button" onClick={() => session?.user ? setAccountOpen(true) : signIn.social({ provider: "google", callbackURL: "/" })}><Mail size={15}/>{weeklyEmailEnabled ? "Weekly Gmail report is on" : "Get this in Gmail every Sunday"}</button>
            </article>
          </div>

          <div className="lower-grid">
            <article className="panel recent-panel">
              <div className="panel-head"><div><p className="eyebrow">FRESHLY SORTED</p><h2>Recent transactions</h2></div><span className="ai-label"><Sparkles size={13}/>{statement.provider === "groq" ? "Groq" : statement.provider === "vertex" ? "Gemini" : statement.provider === "local" ? "Local parser" : "Imported"} categorized</span></div>
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
        </>)}

        {view === "transactions" && (sessionPending || accountLoading ? <WorkspaceSkeleton/> : !session?.user ? <EmptyWorkspace signedIn={false} uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/" })} onUpload={() => fileRef.current?.click()}/> : !hasData ? <EmptyWorkspace signedIn uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/" })} onUpload={() => fileRef.current?.click()}/> : <section className="view-page">
          <div className="view-heading"><div><p className="eyebrow">YOUR CLEAN LEDGER</p><h1>Transactions</h1><p>{statement.transactions.length} payments from {statement.bankName}. Click any category to correct it.</p></div><div className="view-actions"><select className="export-select" defaultValue="" onChange={(event) => { if (event.target.value) exportData(event.target.value as "csv" | "json" | "xlsx" | "markdown"); event.target.value = ""; }}><option value="" disabled>Export…</option><option value="csv">CSV</option><option value="xlsx">Excel</option><option value="json">JSON</option><option value="markdown">Markdown</option></select><button className="secondary-button" onClick={() => receiptRef.current?.click()}><Camera size={16}/>Scan receipt</button><button className="primary-button" onClick={() => fileRef.current?.click()}><UploadCloud size={16}/>Import statement</button></div></div>
          <div className="filter-bar"><label><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search merchant, narration, category…"/></label><span>{visibleTransactions.length} result{visibleTransactions.length === 1 ? "" : "s"}</span></div>
          <div className="panel ledger-panel"><div className="transaction-table"><div className="transaction-head"><span>Merchant</span><span>Date</span><span>Category</span><span>Confidence</span><span>Amount</span></div>{visibleTransactions.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} onCategory={(category) => updateCategory(transaction.id, category)} />)}</div></div>
        </section>)}

        {view === "agent" && (sessionPending || accountLoading ? <WorkspaceSkeleton/> : !session?.user ? <EmptyWorkspace signedIn={false} uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/" })} onUpload={() => fileRef.current?.click()}/> : !hasData ? <EmptyWorkspace signedIn uploading={uploading} uploadLabel={uploadLabel} onSignIn={() => signIn.social({ provider: "google", callbackURL: "/" })} onUpload={() => fileRef.current?.click()}/> : <section className="agent-page">
          <div className="agent-copy"><p className="eyebrow"><span className="live-dot"/>YOUR FINANCIAL COPILOT</p><h1>Ask your money<br/>a real question.</h1><p>Finora gives your agent a clean financial memory through MCP — not a screenshot, not a vague guess.</p><div className="agent-proof"><span><Check size={14}/>Reads your corrected categories</span><span><Check size={14}/>Answers from transaction evidence</span><span><Check size={14}/>Works inside Codex</span></div></div>
          <div className="agent-console">
            <div className="console-head"><div><Mark/><span><strong>Finora agent</strong><small><i/>MCP connected · {statement.transactions.length} transactions</small></span></div><MoreHorizontal size={19}/></div>
            <div className="chat-body"><div className="bot-message"><span>{asking ? <LoaderCircle className="spin" size={16}/> : <Sparkles size={16}/>}</span><p>{asking ? "Reading your ledger…" : answer}</p></div><div className="suggestion-grid">{["Where did I waste the most?", "Which merchant charged me twice?", "Show subscriptions", "Compare June vs July", "What's my average daily spending?", "How is my budget doing?"].map((prompt) => <button key={prompt} onClick={() => askAgent(prompt)}>{prompt}<ChevronRight size={14}/></button>)}</div></div>
            <form className="ask-form" onSubmit={(event) => { event.preventDefault(); askAgent(); }}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about your money…"/><button aria-label="Ask Finora"><ArrowUpRight size={18}/></button></form>
            <div className="console-foot"><code>finora.get_spending_summary</code><span>Evidence-backed</span></div>
          </div>
        </section>)}
      </section>

      <footer><div className="footer-brand"><Mark/><span>Built for OpenAI Build Week · Apps for your life</span></div><div><span>Gemini 2.5</span><span>Groq fallback</span><span>MCP</span></div></footer>

      <input ref={fileRef} type="file" accept=".pdf,.csv,.tsv,.txt,.xlsx,.xls,image/png,image/jpeg" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void handleFile(file); }}/>
      <input ref={receiptRef} type="file" accept="image/png,image/jpeg,.pdf" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void handleFile(file, true); }}/>
      {sheetOpen && <div className="modal-backdrop" onMouseDown={() => setSheetOpen(false)}><div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={() => setSheetOpen(false)}><X size={18}/></button><span className="modal-icon"><FileSpreadsheet size={24}/></span><p className="eyebrow">ONE-TAP REPORTING</p><h2>Send it to Sheets</h2><p>Finora will create raw transactions, monthly, category, merchant and subscription summaries, pivot analysis, and charts in your own Google Sheet.</p>
        <label>Apps Script web app URL<input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://script.google.com/macros/s/…/exec"/></label><label>Sync secret <small>(optional)</small><input type="password" value={sheetSecret} onChange={(event) => setSheetSecret(event.target.value)} placeholder="Matches FINORA_SECRET in Code.gs"/></label>
        <details><summary>How do I get this URL?</summary><ol><li>Open the included <code>integrations/google-sheets/Code.gs</code>.</li><li>Paste it into a new Apps Script project.</li><li>Deploy as a web app, then paste its URL here.</li></ol></details>
        <button className="modal-action" onClick={syncSheets} disabled={syncing}>{syncing ? <><LoaderCircle className="spin" size={17}/>Building your sheet…</> : <><Cloud size={17}/>Create report in Google Sheets</>}</button>
        <small className="privacy-note"><LockKeyhole size={12}/>Data goes only to the Apps Script URL you provide.</small>
      </div></div>}

      {accountOpen && session?.user && <div className="modal-backdrop" onMouseDown={() => setAccountOpen(false)}><div className="modal account-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={() => setAccountOpen(false)}><X size={18}/></button>
        <div className="account-person">{session.user.image ? <img src={session.user.image} alt=""/> : <span><UserRound size={22}/></span>}<div><p className="eyebrow">FINORA ACCOUNT</p><h2>{session.user.name}</h2><small>{session.user.email}</small></div></div>
        <div className="report-setting"><span className="modal-icon"><Mail size={22}/></span><div><h3>Sunday money story</h3><p>Finora sends your weekly spend, largest category, health score, subscriptions, and one useful suggestion to this Gmail address.</p></div></div>
        <label>Report timezone<select value={reportTimezone} onChange={(event) => { setReportTimezone(event.target.value); if (weeklyEmailEnabled) void savePreferences(true, event.target.value); }}><option value="Asia/Kolkata">India · Asia/Kolkata</option><option value="America/New_York">US · New York</option><option value="America/Los_Angeles">US · Los Angeles</option><option value="Europe/London">UK · London</option><option value="Asia/Singapore">Singapore</option></select></label>
        {weeklyEmailEnabled ? <button className="modal-action report-off" onClick={disableWeeklyEmail}><Mail size={16}/>Turn off weekly email</button> : <button className="modal-action" onClick={enableWeeklyEmail}><Mail size={16}/>Allow Gmail & enable report</button>}
        <small className="privacy-note"><ShieldCheck size={12}/>Finora can send this report, but cannot read your inbox.</small>
        {hasData && <button className="clear-data-link" onClick={clearLedger}><Trash2 size={14}/>Clear imported data</button>}
        <button className="sign-out-link" onClick={() => { setAccountOpen(false); setStatement(emptyStatement); setBudgets([]); setAccountLoadedFor(null); signOut(); }}><LogOut size={15}/>Sign out</button>
        {accountLoading && <div className="account-loading"><LoaderCircle className="spin" size={18}/></div>}
      </div></div>}

      {toast && <div className={`toast ${toast.tone}`}><span>{toast.tone === "good" ? <Check size={15}/> : <AlertCircle size={15}/>}</span>{toast.message}</div>}
    </main>
  );
}
