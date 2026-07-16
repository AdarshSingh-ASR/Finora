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
  "parse_statement", "categorize_transactions", "monthly_summary",
  "detect_subscriptions", "find_duplicates", "answer_finance_question",
  "sync_to_sheet",
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

  return (
    <main className="finora-landing" id="top">
      <section className="beige-hero">
        <nav className="beige-nav" aria-label="Main navigation">
          <a className="beige-brand" href="#top"><FinoraMark/><span>finora</span></a>
          <div className="beige-nav-links"><a href="#what">What we do</a><a href="#mcp">MCP</a><a href="#control">Privacy</a></div>
          <button onClick={openFinora} disabled={isPending}>{session?.user ? "Open workspace" : "Analyze a statement"}<ArrowRight size={15}/></button>
        </nav>

        <div className="beige-hero-title">
          <p>01 · THE MONEY LAYER</p>
          <h1>Every statement.<br/><em>One money story.</em></h1>
        </div>

        <div className="beige-hero-animation"><PaymentFlowAnimation /></div>

        <div className="beige-hero-foot">
          <p><span>ANY BANK · CARD · UPI</span>Messy financial files become one explainable memory.</p>
          <p><span>PRIVATE BY DEFAULT</span>Real data only. Raw statements are never kept.</p>
        </div>
      </section>

      <section className="beige-what arrow-field" id="what">
        <div className="beige-section-heading"><p>02 · THE LEDGER</p><h2>What we do here.</h2></div>
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
          <p>03 · THE AGENT SURFACE</p>
          <h2>The MCP is not an add-on.<br/><em>It is the product.</em></h2>
          <p>Focused tools let any compatible agent parse, review, analyze, question, and export your financial memory without forcing one monolithic workflow.</p>
          <button onClick={openFinora}>Connect my money memory <ArrowRight size={16}/></button>
        </div>
        <div className="beige-mcp-console" aria-label="Finora MCP tools">
          <header><span><FinoraMark/><strong>finora-mcp</strong></span><small><i/> AGENT READY</small></header>
          <div className="mcp-orbit" aria-hidden="true"><span><Bot size={23}/></span><i/><i/><i/></div>
          <div className="beige-tool-list">
            {mcpTools.map((tool, index) => <div key={tool}><span>{String(index + 1).padStart(2, "0")}</span><code>{tool}()</code><i>AVAILABLE</i></div>)}
          </div>
          <footer><Sparkles size={15}/><span>The skill teaches the agent when to parse, review, ask, and sync.</span></footer>
        </div>
      </section>

      <section className="beige-control arrow-field" id="control">
        <div className="beige-section-heading"><p>04 · YOUR CONTROL</p><h2>Your statement is input.<br/><em>Not inventory.</em></h2></div>
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
