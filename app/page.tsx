"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowDownLeft, ArrowUpRight, BadgeCheck, Bot, Check, ChevronRight,
  CircleHelp, Cloud, Download, FileSpreadsheet, FileText, LayoutDashboard,
  LoaderCircle, LockKeyhole, Menu, MoreHorizontal, ReceiptIndianRupee, Search,
  Settings2, Sparkles, UploadCloud, WalletCards, X, Zap,
} from "lucide-react";
import { categories, money, summarize } from "../lib/finance";
import { categoryColors, sampleStatement } from "../lib/sample-data";
import type { Category, StatementResult, Transaction } from "../lib/types";

type View = "overview" | "transactions" | "agent";
type Toast = { tone: "good" | "bad"; message: string } | null;

const trend = [18, 24, 21, 33, 29, 37, 34, 48, 41, 55, 49, 63, 58, 71];

function MiniTrend() {
  const points = trend.map((value, index) => `${(index / (trend.length - 1)) * 100},${72 - value}`).join(" ");
  return (
    <svg className="trend-chart" viewBox="0 0 100 75" preserveAspectRatio="none" aria-label="Spending trend">
      <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#275dff" stopOpacity=".24"/><stop offset="1" stopColor="#275dff" stopOpacity="0"/></linearGradient></defs>
      <path d={`M0,75 L${points} L100,75 Z`} fill="url(#area)" />
      <polyline points={points} fill="none" stroke="#275dff" strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
  const [view, setView] = useState<View>("overview");
  const [statement, setStatement] = useState<StatementResult>(sampleStatement);
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
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("Ask about a merchant, category, recurring charge, or how much is safe to spend.");
  const fileRef = useRef<HTMLInputElement>(null);

  const summary = useMemo(() => summarize(statement.transactions), [statement]);
  const categoryEntries = useMemo(() => Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]), [summary]);
  const visibleTransactions = statement.transactions.filter((transaction) => `${transaction.merchant} ${transaction.description} ${transaction.category}`.toLowerCase().includes(search.toLowerCase()));

  function notify(message: string, tone: "good" | "bad" = "good") {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 4200);
  }

  async function handleFile(file?: File) {
    if (!file) return;
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
      setUploadLabel("Finding transactions with GPT-5.6…");
      const response = await fetch("/api/categorize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, fileData, text }),
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Statement analysis failed.");
      setStatement(result);
      setSynced(false);
      setView("overview");
      notify(result.demo ? "Statement loaded in demo mode. Add OPENAI_API_KEY for full document intelligence." : `${result.transactions.length} transactions found and categorized.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "We couldn't read that statement.", "bad");
    } finally { setUploading(false); }
  }

  function updateCategory(id: string, category: Category) {
    setStatement((current) => ({ ...current, transactions: current.transactions.map((transaction) => transaction.id === id ? { ...transaction, category, confidence: 1, explanation: "Category confirmed by you." } : transaction) }));
    setSynced(false);
  }

  function exportCsv() {
    const header = ["Date", "Merchant", "Description", "Type", "Amount", "Category", "Confidence"];
    const rows = statement.transactions.map((t) => [t.date, t.merchant, t.description, t.type, t.amount, t.category, t.confidence]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "finora-transactions.csv"; anchor.click(); URL.revokeObjectURL(url);
    notify("Clean ledger exported as CSV.");
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

  function askAgent(prompt = question) {
    if (!prompt.trim()) return;
    setQuestion(prompt);
    const lower = prompt.toLowerCase();
    const top = categoryEntries[0];
    const recurring = statement.transactions.filter((t) => /netflix|cult|spotify|subscription|standing|\bsi\b/i.test(`${t.merchant} ${t.description}`));
    if (/safe|left|spend/.test(lower)) setAnswer(`You have ${money(summary.saved)} left after recorded outflows. Keeping a 55% buffer for savings and upcoming fixed costs leaves about ${money(Math.max(0, summary.saved * .45))} safe to spend.`);
    else if (/recurr|subscription/.test(lower)) setAnswer(`I found ${recurring.length} likely recurring charges totaling ${money(recurring.reduce((a, t) => a + t.amount, 0))}: ${recurring.map((t) => t.merchant).join(", ") || "none in this period"}.`);
    else if (/food|dining/.test(lower)) setAnswer(`Food & Dining is ${money(summary.byCategory["Food & Dining"] || 0)} across ${statement.transactions.filter((t) => t.category === "Food & Dining").length} transactions. Blinkit and Swiggy account for most of it.`);
    else setAnswer(`${top?.[0] || "Spending"} is your largest outflow at ${money(top?.[1] || 0)}. You saved ${money(summary.saved)}, a ${summary.savingsRate.toFixed(0)}% savings rate for this statement period.`);
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
          <button className="sheet-button" onClick={() => setSheetOpen(true)}>{synced ? <Check size={15}/> : <FileSpreadsheet size={16}/>}<span>{synced ? "Synced" : "Sync Sheets"}</span></button>
          <button className="avatar" aria-label="Account menu">AK</button>
          <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open menu"><Menu size={20}/></button>
        </div>
      </header>

      <section className="content-wrap">
        {view === "overview" && <>
          <div className="welcome-row">
            <div><p className="eyebrow"><span className="live-dot" />MONEY SNAPSHOT · {statement.period.toUpperCase()}</p><h1>Your money,<br/><span>finally legible.</span></h1></div>
            <div className="source-card"><span className="bank-mark">{statement.bankName.slice(0, 1)}</span><span><small>Source</small><strong>{statement.bankName}</strong></span><BadgeCheck size={18}/></div>
          </div>

          <div className="metric-grid">
            <article className="metric-card spend-card"><div className="metric-label"><span>Spent</span><span className="metric-chip down">↓ 8% vs last</span></div><strong>{money(summary.spend)}</strong><small>across {statement.transactions.filter((t) => t.type === "debit").length} payments</small><MiniTrend /></article>
            <article className="metric-card"><div className="metric-label"><span>Income</span><ArrowDownLeft size={17}/></div><strong>{money(summary.income)}</strong><small>money in this period</small><div className="mini-bar"><i style={{ width: "88%" }}/></div></article>
            <article className="metric-card ink-card"><div className="metric-label"><span>Saved</span><Sparkles size={17}/></div><strong>{money(summary.saved)}</strong><small>{summary.savingsRate.toFixed(0)}% savings rate</small><span className="good-pill">On track</span></article>
            <article className="metric-card safe-card"><div className="metric-label"><span>Safe to spend</span><CircleHelp size={17}/></div><strong>{money(Math.max(0, summary.saved * .45))}</strong><small>until month-end</small><span className="scribble">after bills + goals</span></article>
          </div>

          <div className="story-grid">
            <article className="panel category-panel">
              <div className="panel-head"><div><p className="eyebrow">WHERE IT WENT</p><h2>Spend by category</h2></div><button className="ghost-button" onClick={() => setView("transactions")}>See all <ChevronRight size={15}/></button></div>
              <div className="category-story">
                <div className="donut" style={{ background: `conic-gradient(${categoryEntries.map(([category, value], index) => { const before = categoryEntries.slice(0, index).reduce((a, [, n]) => a + n, 0) / summary.spend * 100; const after = (categoryEntries.slice(0, index + 1).reduce((a, [, n]) => a + n, 0) / summary.spend) * 100; return `${categoryColors[category] || "#aaa"} ${before}% ${after}%`; }).join(",")})` }}><div><strong>{money(summary.spend)}</strong><span>total spent</span></div></div>
                <div className="category-list">{categoryEntries.slice(0, 6).map(([category, value]) => <div key={category}><span><i style={{ background: categoryColors[category] }}/>{category}</span><strong>{money(value)}</strong><div><i style={{ width: `${(value / (categoryEntries[0]?.[1] || 1)) * 100}%`, background: categoryColors[category] }}/></div></div>)}</div>
              </div>
            </article>

            <article className="panel insight-panel">
              <div className="insight-title"><span><Zap size={18}/></span><div><p className="eyebrow">FINORA NOTICED</p><h2>Worth your attention</h2></div></div>
              <div className="insight-list">{statement.insights.map((insight, index) => <div className="insight" key={insight}><span>{index + 1}</span><p>{insight}</p></div>)}</div>
              <button className="ask-button" onClick={() => setView("agent")}><Sparkles size={16}/>Ask a follow-up<ChevronRight size={15}/></button>
            </article>
          </div>

          <div className="lower-grid">
            <article className="panel recent-panel">
              <div className="panel-head"><div><p className="eyebrow">FRESHLY SORTED</p><h2>Recent transactions</h2></div><span className="ai-label"><Sparkles size={13}/>GPT-5.6 categorized</span></div>
              <div className="transaction-table compact"><div className="transaction-head"><span>Merchant</span><span>Date</span><span>Category</span><span>Confidence</span><span>Amount</span></div>{statement.transactions.slice(0, 5).map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} onCategory={(category) => updateCategory(transaction.id, category)} />)}</div>
              <button className="full-row-button" onClick={() => setView("transactions")}>View all {statement.transactions.length} transactions <ChevronRight size={15}/></button>
            </article>

            <article className={`upload-card ${isDragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); handleFile(event.dataTransfer.files[0]); }}>
              <div className="upload-icon"><UploadCloud size={25}/></div>
              <p className="eyebrow">ADD ANOTHER ACCOUNT</p><h2>Drop any statement.</h2><p>PDF, CSV, XLSX, scanned image — from any bank or UPI app.</p>
              <button onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <><LoaderCircle className="spin" size={17}/>{uploadLabel}</> : <><FileText size={17}/>Choose statement</>}</button>
              <input ref={fileRef} type="file" accept=".pdf,.csv,.tsv,.txt,.xlsx,.xls,image/png,image/jpeg" hidden onChange={(event) => handleFile(event.target.files?.[0])}/>
              <small><LockKeyhole size={12}/>Encrypted in transit · never used to train models</small>
            </article>
          </div>
        </>}

        {view === "transactions" && <section className="view-page">
          <div className="view-heading"><div><p className="eyebrow">YOUR CLEAN LEDGER</p><h1>Transactions</h1><p>{statement.transactions.length} payments from {statement.bankName}. Click any category to correct it.</p></div><div className="view-actions"><button className="secondary-button" onClick={exportCsv}><Download size={16}/>Export CSV</button><button className="primary-button" onClick={() => fileRef.current?.click()}><UploadCloud size={16}/>Import statement</button></div></div>
          <div className="filter-bar"><label><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search merchant, narration, category…"/></label><button><Settings2 size={16}/>Filters</button><span>{visibleTransactions.length} results</span></div>
          <div className="panel ledger-panel"><div className="transaction-table"><div className="transaction-head"><span>Merchant</span><span>Date</span><span>Category</span><span>Confidence</span><span>Amount</span></div>{visibleTransactions.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} onCategory={(category) => updateCategory(transaction.id, category)} />)}</div></div>
        </section>}

        {view === "agent" && <section className="agent-page">
          <div className="agent-copy"><p className="eyebrow"><span className="live-dot"/>YOUR FINANCIAL COPILOT</p><h1>Ask your money<br/>a real question.</h1><p>Finora gives your agent a clean financial memory through MCP — not a screenshot, not a vague guess.</p><div className="agent-proof"><span><Check size={14}/>Reads your corrected categories</span><span><Check size={14}/>Answers from transaction evidence</span><span><Check size={14}/>Works inside Codex</span></div></div>
          <div className="agent-console">
            <div className="console-head"><div><Mark/><span><strong>Finora agent</strong><small><i/>MCP connected · {statement.transactions.length} transactions</small></span></div><MoreHorizontal size={19}/></div>
            <div className="chat-body"><div className="bot-message"><span><Sparkles size={16}/></span><p>{answer}</p></div><div className="suggestion-grid">{["What can I safely spend?", "Find recurring charges", "Break down my food spend", "What changed this month?"].map((prompt) => <button key={prompt} onClick={() => askAgent(prompt)}>{prompt}<ChevronRight size={14}/></button>)}</div></div>
            <form className="ask-form" onSubmit={(event) => { event.preventDefault(); askAgent(); }}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about your money…"/><button aria-label="Ask Finora"><ArrowUpRight size={18}/></button></form>
            <div className="console-foot"><code>finora.get_spending_summary</code><span>Evidence-backed</span></div>
          </div>
        </section>}
      </section>

      <footer><div className="footer-brand"><Mark/><span>Built for OpenAI Build Week · Apps for your life</span></div><div><span>GPT-5.6</span><span>MCP</span><span>Google Sheets</span></div></footer>

      {sheetOpen && <div className="modal-backdrop" onMouseDown={() => setSheetOpen(false)}><div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={() => setSheetOpen(false)}><X size={18}/></button><span className="modal-icon"><FileSpreadsheet size={24}/></span><p className="eyebrow">ONE-TAP REPORTING</p><h2>Send it to Sheets</h2><p>Finora will create a clean ledger, monthly summary, category rollup, and two charts in your own Google Sheet.</p>
        <label>Apps Script web app URL<input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://script.google.com/macros/s/…/exec"/></label><label>Sync secret <small>(optional)</small><input type="password" value={sheetSecret} onChange={(event) => setSheetSecret(event.target.value)} placeholder="Matches FINORA_SECRET in Code.gs"/></label>
        <details><summary>How do I get this URL?</summary><ol><li>Open the included <code>integrations/google-sheets/Code.gs</code>.</li><li>Paste it into a new Apps Script project.</li><li>Deploy as a web app, then paste its URL here.</li></ol></details>
        <button className="modal-action" onClick={syncSheets} disabled={syncing}>{syncing ? <><LoaderCircle className="spin" size={17}/>Building your sheet…</> : <><Cloud size={17}/>Create report in Google Sheets</>}</button>
        <small className="privacy-note"><LockKeyhole size={12}/>Data goes only to the Apps Script URL you provide.</small>
      </div></div>}

      {toast && <div className={`toast ${toast.tone}`}><span>{toast.tone === "good" ? <Check size={15}/> : <AlertCircle size={15}/>}</span>{toast.message}</div>}
    </main>
  );
}
