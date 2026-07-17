"use client";

import {
  ArrowRight, Bot, BrainCircuit, FileScan, FileSpreadsheet,
  Fingerprint, LockKeyhole, ShieldCheck, Sparkles,
} from "lucide-react";
import { signIn, useSession } from "../lib/auth-client";
import { PaymentFlowAnimation } from "./payment-flow-animation";

const capabilities = [
  {
    number: "01",
    label: "READ",
    title: "Bring any statement",
    body: "Bank PDFs, card statements, CSV exports, screenshots, Excel files, and UPI history all enter the same clean ledger.",
    motif: "documents",
  },
  {
    number: "02",
    label: "UNDERSTAND",
    title: "Find the real pattern",
    body: "Finora cleans merchants, separates P2P transfers, categorizes with confidence, and surfaces duplicates, subscriptions, and anomalies.",
    motif: "intelligence",
  },
  {
    number: "03",
    label: "USE",
    title: "Put clarity to work",
    body: "Ask questions, compare months, build a living Google Sheets report, or let an agent use one focused finance tool at a time.",
    motif: "report",
  },
];

const mcpTools = [
  "sync_statement", "analyze_finances", "financial_timeline",
  "find_savings", "explain_spending_change", "predict_month_end_spending",
  "generate_dashboard",
];

function FinoraMark() {
  return <span className="beige-mark" aria-hidden="true">F</span>;
}

export default function LandingPage() {
  const { data: session, isPending } = useSession();

  const openFinora = () => {
    if (session?.user) window.location.href = "/dashboard";
    else void signIn.social({ provider: "google", callbackURL: "/dashboard" });
  };

  const downloadSkill = () => {
    const link = document.createElement("a");
    link.href = "/downloads/finora-finance.zip";
    link.download = "finora-finance.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => { window.location.href = "/install"; }, 450);
  };

  return (
    <main className="finora-landing" id="top">
      <section className="beige-hero">
        <nav className="beige-nav" aria-label="Main navigation">
          <a className="beige-brand" href="#top"><FinoraMark/><span>finora</span></a>
          <div className="beige-nav-links"><a href="#what">What we do</a><a href="#mcp">MCP</a><a href="#control">Privacy</a></div>
          <button onClick={openFinora} disabled={isPending}>{session?.user ? "Open workspace" : "Analyze a statement"}<ArrowRight size={15}/></button>
        </nav>

        <div className="beige-hero-copy">
          <p>01 · YOUR MONEY, MADE LEGIBLE</p>
          <h1>Every statement.<br/><em>One money story.</em></h1>
          <p>Turn bank, card, and UPI activity into a private financial memory you can understand, question, and use.</p>
          <div className="beige-hero-actions">
            <button onClick={openFinora} disabled={isPending}>Analyze my statement <ArrowRight size={16}/></button>
            <a href="#flow">See how it works</a>
          </div>
        </div>

        <div className="beige-hero-foot">
          <p><span>ANY BANK · CARD · UPI</span>One private, explainable ledger.</p>
          <p><span>REAL DATA ONLY</span>No sample transactions. Raw files are never kept.</p>
        </div>
      </section>

      <section className="beige-flow" id="flow" aria-labelledby="flow-heading">
        <div className="beige-flow-heading">
          <p>02 · FROM FILE TO FINANCIAL MEMORY</p>
          <h2 id="flow-heading">Financial noise in.<br/><em>Useful clarity out.</em></h2>
          <span>Statements and UPI activity become one categorized, explainable report.</span>
        </div>
        <div className="beige-flow-animation"><PaymentFlowAnimation /></div>
      </section>

      <section className="beige-what arrow-field" id="what">
        <div className="beige-section-heading"><p>03 · THE LEDGER</p><h2>What we do here.</h2></div>
        <div className="beige-capability-grid">
          {capabilities.map((item) => (
            <article key={item.number} className={`beige-capability beige-capability-${item.motif}`}>
              <header><span>{item.number}</span><span>{item.label}</span></header>
              <div className="beige-card-motif" aria-hidden="true">
                {item.motif === "documents" && <div className="motif-documents"><i>PDF</i><i>CSV</i><i>UPI</i></div>}
                {item.motif === "intelligence" && <div className="motif-intelligence"><i/><i/><i/><i/><span><BrainCircuit size={27}/></span></div>}
                {item.motif === "report" && <div className="motif-report"><i/><i/><i/><svg viewBox="0 0 80 34"><path d="M3 29C18 26 18 18 31 21S47 8 58 13 67 4 77 3"/></svg></div>}
              </div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="beige-mcp" id="mcp">
        <div className="beige-mcp-copy">
          <p>04 · THE AGENT SURFACE</p>
          <h2>The MCP is not an add-on.<br/><em>It is the product.</em></h2>
          <p>Finora is a financial intelligence layer for any compatible agent: analyze a ledger, explain change, find savings, forecast the month, and build a dashboard. Focused parsing and spreadsheet tools remain available when precision is useful.</p>
          <button onClick={downloadSkill}>Connect my money memory <ArrowRight size={16}/></button>
        </div>
        <div className="beige-mcp-console" aria-label="Finora MCP tools">
          <header><span><FinoraMark/><strong>finora-mcp</strong></span><small><i/> AGENT READY</small></header>
          <div className="mcp-orbit" aria-hidden="true"><span><Bot size={23}/></span><i/><i/><i/></div>
          <div className="beige-tool-list">
            {mcpTools.map((tool, index) => <div key={tool}><span>{String(index + 1).padStart(2, "0")}</span><code>{tool}()</code><i>AVAILABLE</i></div>)}
          </div>
          <footer><Sparkles size={15}/><span>The skill chooses outcome tools first, then uses precise ledger or Sheet edits only when requested.</span></footer>
        </div>
      </section>

      <section className="beige-control arrow-field" id="control">
        <div className="beige-section-heading"><p>05 · YOUR CONTROL</p><h2>Your statement is input.<br/><em>Not inventory.</em></h2></div>
        <div className="beige-control-grid">
          <article><FileScan/><span><strong>Raw files disappear</strong><small>Processed in-request and never retained.</small></span></article>
          <article><Fingerprint/><span><strong>Evidence stays attached</strong><small>Every category can show its reason.</small></span></article>
          <article><FileSpreadsheet/><span><strong>Your Sheet is yours</strong><small>Nothing syncs until you confirm it.</small></span></article>
          <article><LockKeyhole/><span><strong>Account-scoped ledger</strong><small>Only your sign-in can access your data.</small></span></article>
        </div>
        <div className="beige-final-cta">
          <span><ShieldCheck size={18}/>START WITH ONE REAL STATEMENT</span>
          <h2>See your money<br/><em>as one clear system.</em></h2>
          <button onClick={openFinora} disabled={isPending}>{session?.user ? "Open my workspace" : "Continue with Google"}<ArrowRight size={17}/></button>
        </div>
        <footer className="beige-footer"><a className="beige-brand" href="#top"><FinoraMark/><span>finora</span></a><p>Statement in. Money story out.</p><small>© 2026 Finora · Information, not financial advice.</small></footer>
      </section>
    </main>
  );
}
