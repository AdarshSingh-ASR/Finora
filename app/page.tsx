"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, BadgeCheck, Bot, BrainCircuit, ChartNoAxesCombined, Check,
  ChevronRight, CircleCheck, Database, FileSpreadsheet, FileUp, Fingerprint, Gauge,
  MessageCircleQuestion, ReceiptText, Repeat2, ScanSearch, ShieldCheck, Sparkles,
  WandSparkles,
} from "lucide-react";
import { signIn, useSession } from "../lib/auth-client";
import { PaymentFlowAnimation } from "./payment-flow-animation";

const inputFormats = [
  { label: "Bank account statement", tag: "PDF" },
  { label: "UPI payment history", tag: "UPI" },
  { label: "Card statement", tag: "PDF" },
  { label: "Transaction export", tag: "CSV" },
  { label: "Workbook statement", tag: "XLSX" },
  { label: "Receipt or screenshot", tag: "OCR" },
  { label: "Any bank format", tag: "AI" },
];

const steps = [
  { number: "01", title: "Bring your statement", body: "Upload the bank, card, or UPI file you already have. Finora starts with your data—never a sample ledger." },
  { number: "02", title: "Make every row trustworthy", body: "Merchants are cleaned, transfers are separated from spend, and uncertain categories stay reviewable." },
  { number: "03", title: "Put your money memory to work", body: "Ask questions, build your Google Sheets dashboard, or give an agent one focused MCP tool at a time." },
];

const capabilities = [
  { icon: ScanSearch, title: "Any statement format", body: "Gemini 2.5 Flash normalizes inconsistent columns, OCR, regional date formats, and messy UPI narrations." },
  { icon: ReceiptText, title: "Clean merchant memory", body: "AMZN PAY, Amazon Seller Services, and Amazon become one merchant without losing the original narration." },
  { icon: Repeat2, title: "Subscriptions that surface themselves", body: "Recurring cadence, estimated renewal dates, and annualized costs are detected from the ledger you imported." },
  { icon: Gauge, title: "Signals, not decorative scores", body: "Budgets, duplicate payments, unusual merchants, spending jumps, and financial health use your actual transactions." },
  { icon: MessageCircleQuestion, title: "Ask your money directly", body: "Find coffee spend, compare months, locate duplicate charges, or inspect a merchant without building a filter maze." },
  { icon: FileSpreadsheet, title: "A Sheet that stays useful", body: "Create raw, monthly, category, merchant, and subscription views with charts in your own Google Sheet." },
];

const tools = ["parse_statement", "categorize_transactions", "detect_subscriptions", "compare_months", "answer_finance_question", "sync_to_sheet"];

function FinoraMark() {
  return <span className="landing-mark" aria-hidden="true">F</span>;
}

export default function LandingPage() {
  const { data: session, isPending } = useSession();
  const [navPhase, setNavPhase] = useState<"top" | "compact" | "floating">("top");
  const [activeStep, setActiveStep] = useState(0);
  const stepsStoryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const updateNav = () => {
      const floatingAt = Math.max(520, window.innerHeight * .72);
      setNavPhase(window.scrollY <= 44 ? "top" : window.scrollY < floatingAt ? "compact" : "floating");
    };
    updateNav();
    window.addEventListener("scroll", updateNav, { passive: true });
    window.addEventListener("resize", updateNav);
    return () => { window.removeEventListener("scroll", updateNav); window.removeEventListener("resize", updateNav); };
  }, []);

  useEffect(() => {
    const updateStep = () => {
      const section = stepsStoryRef.current;
      if (!section) return;
      const scrollable = Math.max(1, section.offsetHeight - window.innerHeight);
      const progress = Math.min(0.999, Math.max(0, -section.getBoundingClientRect().top / scrollable));
      setActiveStep(Math.min(steps.length - 1, Math.floor(progress * steps.length)));
    };
    updateStep();
    window.addEventListener("scroll", updateStep, { passive: true });
    window.addEventListener("resize", updateStep);
    return () => { window.removeEventListener("scroll", updateStep); window.removeEventListener("resize", updateStep); };
  }, []);

  const openFinora = () => {
    if (session?.user) window.location.href = "/dashboard";
    else void signIn.social({ provider: "google", callbackURL: "/dashboard" });
  };

  return <main className="landing-shell" id="top">
    <section className="landing-hero">
      <nav className={`landing-nav landing-nav-${navPhase}`} aria-label="Main navigation">
        <a className="landing-brand" href="#top"><FinoraMark/><span>finora</span></a>
        <div className="landing-links"><a href="#how">How it works</a><a href="#intelligence">Intelligence</a><a href="#agents">For agents</a><a href="#privacy">Privacy</a></div>
        <div className="landing-nav-actions"><button className="landing-login" onClick={openFinora} disabled={isPending}>{session?.user ? "Open app" : "Sign in"}</button><button className="landing-nav-cta" onClick={openFinora} disabled={isPending}>Analyze a statement</button></div>
      </nav>

      <div className="landing-hero-copy">
        <p className="landing-kicker"><span/>YOUR MONEY, MADE LEGIBLE</p>
        <h1>Statements get messy.<br/><em>Your money story stays clear.</em></h1>
        <p>Finora turns any bank, card, or UPI statement into an explainable financial memory—then makes it useful in Google Sheets and any MCP-compatible AI agent.</p>
        <div className="landing-hero-actions"><button className="landing-primary" onClick={openFinora} disabled={isPending}>Analyze my statement <ArrowRight size={17}/></button><a className="landing-secondary" href="#how">See how it works</a></div>
        <small><ShieldCheck size={14}/>Starts empty. No sample transactions. Raw files are never stored.</small>
      </div>

      <div className="landing-product" aria-label="Finora product workflow preview">
        <div className="landing-product-bar"><span><FinoraMark/><strong>Finora workspace</strong></span><div><i/><i/><i/></div><small>Private ledger</small></div>
        <div className="landing-product-grid">
          <div className="landing-upload-preview"><span className="preview-icon"><FileUp size={23}/></span><p>START WITH YOUR DATA</p><h2>Drop any statement.</h2><span>Nothing appears until you import it.</span><button onClick={openFinora}>Choose a real file <ArrowRight size={14}/></button></div>
          <div className="landing-pipeline">
            <div className="pipeline-title"><span><Sparkles size={15}/>Live analysis pipeline</span><BadgeCheck size={17}/></div>
            <div className="pipeline-row"><span>01</span><div><strong>Extract every transaction</strong><small>PDF · CSV · Excel · image</small></div><Check size={15}/></div>
            <div className="pipeline-row"><span>02</span><div><strong>Normalize merchants</strong><small>Keep original evidence attached</small></div><Check size={15}/></div>
            <div className="pipeline-row"><span>03</span><div><strong>Categorize with confidence</strong><small>Human-correctable explanations</small></div><Check size={15}/></div>
            <div className="pipeline-row waiting"><span>04</span><div><strong>Build your money story</strong><small>Insights begin after import</small></div><span className="pulse-dot"/></div>
          </div>
          <div className="landing-agent-preview"><div><Bot size={18}/><span><strong>Finora agent</strong><small>Evidence-backed</small></span></div><p>Ask a question after importing your ledger.</p><div className="agent-prompt">“Which subscriptions changed?”</div><span className="agent-proof-line"><Fingerprint size={14}/>Answers use only your data</span></div>
        </div>
      </div>
    </section>

    <section className="format-marquee" aria-label="Supported inputs">
      <p>ONE FINANCIAL MEMORY FROM THE FILES YOU ALREADY HAVE</p>
      <div>
        <span>{inputFormats.map(({ label, tag }) => <i key={`${label}-${tag}`}><span>{label}</span><b>{tag}</b></i>)}</span>
        <span aria-hidden="true">{inputFormats.map(({ label, tag }) => <i key={`${label}-${tag}`}><span>{label}</span><b>{tag}</b></i>)}</span>
      </div>
    </section>

    <section className="payment-flow-section" aria-labelledby="payment-flow-heading">
      <div className="payment-flow-heading">
        <div><p>From payment noise to signal</p><h2 id="payment-flow-heading">Every UPI ping becomes<br/><em>one clear money story.</em></h2></div>
        <p>Finora gathers scattered payment alerts, understands the merchant and context, then turns them into a report you can question, review, and export.</p>
      </div>
      <PaymentFlowAnimation />
    </section>

    <section className="steps-story" id="how" ref={stepsStoryRef}>
      <div className="steps-story-frame">
        <div className="steps-story-heading"><p><span/>How it works</p><h2>From statement to <em>money clarity</em><br/>in three deliberate moves.</h2></div>
        <div className="steps-story-layout">
          <div className="steps-story-copy" aria-label="Finora workflow steps">
            {steps.map(({ number, title, body }, index) => <div key={number} className={`story-step ${activeStep === index ? "active" : ""}`} aria-current={activeStep === index ? "step" : undefined}>
              <span className="story-step-arrow">↳</span>
              <span><small>{number}</small><strong>{title}</strong><div className="story-step-body"><p>{body}</p></div></span>
            </div>)}
          </div>
          <div className="steps-story-card" aria-live="polite">
            <section className={`story-card-panel ${activeStep === 0 ? "active" : ""}`} aria-hidden={activeStep !== 0}>
              <div className="story-card-head"><span><FileUp size={19}/>Statement intake</span><small><i/> Ready</small></div>
              <button className="story-dropzone" onClick={openFinora} tabIndex={activeStep === 0 ? 0 : -1}>
                <span><FileUp size={27}/></span><strong>Choose your real statement</strong><p>Bank, card, or UPI—Finora reads the file you already have.</p><div><i>PDF</i><i>CSV</i><i>XLSX</i><i>IMAGE</i></div>
              </button>
              <div className="story-card-foot"><ShieldCheck size={16}/><span><strong>Private by default</strong><small>Raw files are processed in-request and never become inventory.</small></span><ChevronRight size={17}/></div>
            </section>
            <section className={`story-card-panel ${activeStep === 1 ? "active" : ""}`} aria-hidden={activeStep !== 1}>
              <div className="story-card-head"><span><WandSparkles size={19}/>Explainable ledger</span><small><i/> Reviewable</small></div>
              <div className="story-review-list">
                <article><span><CircleCheck size={17}/></span><div><strong>Normalize merchant names</strong><small>Original narration remains attached as evidence</small></div><b>Ready</b></article>
                <article><span><CircleCheck size={17}/></span><div><strong>Separate UPI transfers</strong><small>P2P repayments stay distinct from real spend</small></div><b>Ready</b></article>
                <article><span><CircleCheck size={17}/></span><div><strong>Categorize with confidence</strong><small>Reasons and low-confidence rows remain editable</small></div><b>Review</b></article>
              </div>
              <div className="story-card-foot"><Fingerprint size={16}/><span><strong>No guessed totals</strong><small>Your ledger stays empty until a real statement is analyzed.</small></span></div>
            </section>
            <section className={`story-card-panel ${activeStep === 2 ? "active" : ""}`} aria-hidden={activeStep !== 2}>
              <div className="story-card-head"><span><Database size={19}/>Your money memory</span><small><i/> Connected</small></div>
              <div className="story-destinations">
                <button onClick={openFinora} tabIndex={activeStep === 2 ? 0 : -1}><span><MessageCircleQuestion size={19}/></span><div><strong>Ask Finora</strong><small>Evidence-backed answers from your transactions</small></div><ChevronRight size={17}/></button>
                <button onClick={openFinora} tabIndex={activeStep === 2 ? 0 : -1}><span><FileSpreadsheet size={19}/></span><div><strong>Google Sheets</strong><small>Summaries and charts after you confirm the ledger</small></div><ChevronRight size={17}/></button>
                <a href="#agents" tabIndex={activeStep === 2 ? 0 : -1}><span><Bot size={19}/></span><div><strong>MCP tools</strong><small>Parse, categorize, analyze, or sync independently</small></div><ChevronRight size={17}/></a>
              </div>
              <div className="story-card-foot"><ShieldCheck size={16}/><span><strong>You stay in control</strong><small>Nothing syncs or exports until you ask.</small></span></div>
            </section>
          </div>
        </div>
        <div className="steps-story-progress" aria-hidden="true"><span style={{ width: `${((activeStep + 1) / steps.length) * 100}%` }}/></div>
      </div>
    </section>

    <section className="intelligence-section" id="intelligence">
      <div className="landing-section landing-section-head split-head"><div><p>The intelligence layer</p><h2>Every signal points back<br/>to <em>real evidence.</em></h2></div><p>Finora does not decorate a dashboard with invented benchmarks. It finds the patterns already present in your ledger and shows why they matter.</p></div>
      <div className="capability-grid">{capabilities.map(({ icon: Icon, title, body }, index) => <article key={title} className={index === 0 || index === 5 ? "feature-wide" : ""}><span><Icon size={22}/></span><h3>{title}</h3><p>{body}</p><small>0{index + 1}</small></article>)}</div>
    </section>

    <section className="agent-section" id="agents">
      <div className="agent-copy-block"><p>Not a web-app wrapper</p><h2>The MCP is<br/><em>the product surface.</em></h2><p>Focused tools let an agent parse, categorize, review, analyze, and export independently. Nothing touches your Sheet until you choose the tool that does it.</p><button className="landing-primary" onClick={openFinora}>Build my money memory <ArrowRight size={17}/></button></div>
      <div className="tool-console"><div className="tool-console-head"><span><FinoraMark/><strong>finora-mcp</strong></span><small><i/> ready</small></div><div className="tool-list">{tools.map((tool, index) => <div key={tool}><span>{String(index + 1).padStart(2, "0")}</span><code>{tool}()</code><ArrowRight size={14}/></div>)}</div><div className="tool-judgment"><BrainCircuit size={18}/><p><strong>The skill teaches judgment.</strong><span>Categorize first. Confirm uncertain transfers. Sync only after review.</span></p></div></div>
    </section>

    <section className="landing-section privacy-section" id="privacy">
      <div><p>Private by design</p><h2>Your statement is input.<br/><em>Not inventory.</em></h2></div>
      <div className="privacy-grid"><article><ShieldCheck size={21}/><strong>Raw files disappear</strong><span>Statements are processed in-request and are not persisted.</span></article><article><Fingerprint size={21}/><strong>Your ledger, your account</strong><span>Only the normalized data you choose is saved under your sign-in.</span></article><article><FileSpreadsheet size={21}/><strong>Your Sheet, your destination</strong><span>Exports go only to the Apps Script endpoint you provide.</span></article></div>
    </section>

    <section className="landing-final"><div className="final-orbit"><ChartNoAxesCombined size={30}/><i/><i/><i/></div><p>Your next money story is already in your bank.</p><h2>Make it <em>legible.</em></h2><button className="landing-primary" onClick={openFinora} disabled={isPending}>{session?.user ? "Open my workspace" : "Continue with Google"}<ArrowRight size={17}/></button><small>No credit card · No sample ledger · Start with one statement</small></section>

    <footer className="landing-footer"><a className="landing-brand" href="#top"><FinoraMark/><span>finora</span></a><p>Statement in. Money story out.</p><div><a href="#how">How it works</a><a href="#agents">MCP</a><a href="/dashboard">App</a></div><small>© 2026 Finora · Information, not financial advice.</small></footer>
  </main>;
}
