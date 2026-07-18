"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Clipboard,
  Download, ExternalLink, GitBranch, ShieldCheck, Terminal,
} from "lucide-react";

const serverUrl = "https://finora.finora-asr.workers.dev";
const installCommand = "npx skills add AdarshSingh-ASR/Finora --skill finora-finance --global --yes";
const zipInstallCommand = "node ./finora-finance/scripts/install.mjs";
const githubCommands = "git clone --depth 1 https://github.com/AdarshSingh-ASR/Finora.git\nnode ./Finora/skills/finora-finance/scripts/install.mjs";

function FinoraMark() {
  return <span className="beige-mark" aria-hidden="true">F</span>;
}

function CommandBlock({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="skill-command">
      <span>{label}</span>
      <pre><code>{value}</code></pre>
      <button type="button" onClick={() => void copy()} aria-label={`Copy ${label}`}>
        {copied ? <Check size={15}/> : <Clipboard size={15}/>} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function InstallSkillPage() {
  return (
    <main className="skill-install-page finora-landing">
      <nav className="skill-install-nav" aria-label="Skill installation navigation">
        <Link className="beige-brand" href="/"><FinoraMark/><span>finora</span></Link>
        <Link href="/"><ArrowLeft size={14}/> Back to Finora</Link>
      </nav>

      <header className="skill-install-hero">
        <div>
          <p>FINORA FINANCE SKILL · AGENT READY</p>
          <h1>Your money memory,<br/><em>inside your agent.</em></h1>
          <span>Install globally with one command, connect with Google on first use, and ask Finora naturally from Codex, Claude, or another compatible agent. The live backend is configured automatically.</span>
        </div>
        <a className="skill-download-button" href="/downloads/finora-finance.zip" download>
          <Download size={17}/> Download ZIP instead
        </a>
      </header>

      <section className="skill-install-grid" aria-labelledby="install-heading">
        <div className="skill-install-main">
          <div className="skill-section-label"><span>01</span><p id="install-heading">INSTALL THE SKILL</p></div>
          <h2>One global install.<br/><em>No server URL to paste.</em></h2>

          <ol className="skill-steps">
            <li>
              <span>01</span>
              <div><h3>Install globally</h3><p>Run this from any terminal. The Skills CLI discovers Finora and installs it at user level for your supported agent.</p><CommandBlock value={installCommand} label="Global install command"/></div>
            </li>
            <li>
              <span>02</span>
              <div><h3>Restart your agent</h3><p>Restart Codex, Claude, or your compatible agent so it discovers the newly installed global skill.</p></div>
            </li>
            <li>
              <span>03</span>
              <div><h3>Connect your Finora account</h3><p>Restart your agent if needed, then use one of these commands. The first request returns a secure Finora sign-in link.</p>
                <div className="skill-invocations"><code>$finora-finance skill-sync</code><span>Codex</span><code>/finance skill-sync</code><span>Claude</span></div>
              </div>
            </li>
          </ol>
        </div>

        <aside className="skill-install-aside">
          <div className="skill-ready-card">
            <header><FinoraMark/><span><strong>finora-finance</strong><small><i/> READY TO INSTALL</small></span></header>
            <ul>
              <li><CheckCircle2/> Parse bank, card, UPI, PDF, CSV, Excel, and image statements</li>
              <li><CheckCircle2/> Categorize, normalize merchants, and detect recurring charges</li>
              <li><CheckCircle2/> Ask grounded finance questions and generate reports</li>
              <li><CheckCircle2/> Create, update, and sync your Google Sheets dashboard</li>
            </ul>
            <p><ShieldCheck/> Authentication happens on Finora. Your Google token is never exposed to the agent.</p>
          </div>

          <div className="skill-github-card">
            <span><GitBranch size={19}/> INSTALL FROM GITHUB</span>
            <h3>Prefer the source?</h3>
            <p>Clone the public repository and run the bundled installer. ZIP users can extract the folder and run <code>{zipInstallCommand}</code>.</p>
            <CommandBlock value={githubCommands} label="GitHub installation"/>
            <a href="https://github.com/AdarshSingh-ASR/Finora/tree/main/skills/finora-finance" target="_blank" rel="noreferrer">View skill on GitHub <ExternalLink size={14}/></a>
          </div>
        </aside>
      </section>

      <section className="skill-after-install">
        <span><Terminal size={19}/> AFTER INSTALLATION</span>
        <h2>Ask for the outcome.<br/><em>Finora handles the workflow.</em></h2>
        <div>
          <p>“Compare food spending with last month.”</p>
          <p>“Find subscriptions I may have forgotten.”</p>
          <p>“Sync this statement to my Google Sheet.”</p>
        </div>
        <a href={`${serverUrl}/connect`}>Connect in the browser <ArrowRight size={15}/></a>
      </section>

      <footer className="skill-install-footer"><Link className="beige-brand" href="/"><FinoraMark/><span>finora</span></Link><p>One account. Every compatible agent.</p><small>© 2026 Finora · Information, not financial advice.</small></footer>
    </main>
  );
}
