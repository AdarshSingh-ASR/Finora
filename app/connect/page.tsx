"use client";

import { useState } from "react";
import { Check, Link2, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { authClient, signIn, useSession } from "../../lib/auth-client";

export default function ConnectFinoraAgent() {
  const { data: session, isPending } = useSession();
  const code = useSearchParams().get("code") || "";
  const capability = useSearchParams().get("capability");
  const frequency = useSearchParams().get("frequency") === "monthly" ? "monthly" : "weekly";
  const [status, setStatus] = useState<"ready" | "approving" | "done" | "error">("ready");
  const [message, setMessage] = useState("");
  async function approve() {
    setStatus("approving");
    const response = await fetch("/api/agent-auth/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userCode: code }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setMessage(result.error || "Could not connect this agent."); setStatus("error"); return; }
    setStatus("done");
  }

  async function authorizeCapability() {
    const scopes = capability === "gmail" ? ["https://www.googleapis.com/auth/gmail.send"] : ["https://www.googleapis.com/auth/drive.file"];
    const callbackURL = capability === "gmail" ? `/dashboard?gmail=connected&frequency=${frequency}` : "/dashboard?sheets=connected&sheetAction=create";
    await authClient.linkSocial({ provider: "google", scopes, callbackURL });
  }

  return <main className="connect-page">
    <section className="connect-card">
      <div className="connect-mark">F</div>
      {status === "done" ? <>
        <Check size={38}/><p className="eyebrow">ACCOUNT CONNECTED</p>
        <h1>Finora is ready in your agent.</h1>
        <p>You can close this tab and return to your conversation. This approval can be revoked at any time.</p>
      </> : capability ? <>
        <ShieldCheck size={34}/><p className="eyebrow">OPTIONAL GOOGLE PERMISSION</p>
        <h1>Connect {capability === "gmail" ? "Gmail reports" : "Google Sheets"}</h1>
        <p>Finora requests only the permission needed for this action. Your AI agent never receives the Google access token.</p>
        {!isPending && !session?.user && <button onClick={() => signIn.social({ provider: "google", callbackURL: `/connect?capability=${capability}&frequency=${frequency}` })}>Continue with Google</button>}
        {!isPending && session?.user && <button onClick={authorizeCapability}>Authorize {capability === "gmail" ? "report delivery" : "Sheets sync"}</button>}
      </> : <>
        <Link2 size={34}/><p className="eyebrow">SECURE AGENT CONNECTION</p>
        <h1>Connect Finora</h1>
        <p>Approve code <strong>{code || "—"}</strong> to let your AI agent use your Finora ledger and requested actions.</p>
        <div className="connect-safety"><ShieldCheck size={18}/><span>The agent never receives your Google password or OAuth tokens.</span></div>
        {!isPending && !session?.user && <button onClick={() => signIn.social({ provider: "google", callbackURL: `/connect?code=${encodeURIComponent(code)}` })}>Continue with Google</button>}
        {!isPending && session?.user && <button onClick={approve} disabled={!code || status === "approving"}>{status === "approving" ? "Connecting…" : `Approve as ${session.user.email}`}</button>}
        {status === "error" && <p className="connect-error">{message}</p>}
      </>}
    </section>
    <style jsx>{`
      .connect-page{min-height:100vh;display:grid;place-items:center;padding:24px;background:#f5faf7;color:#0d2b22;background-image:linear-gradient(rgba(13,43,34,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(13,43,34,.05) 1px,transparent 1px);background-size:40px 40px}
      .connect-card{width:min(560px,100%);border:1px solid #a8d7c8;background:rgba(252,255,253,.96);padding:48px;box-shadow:20px 20px 0 #daf3ea}
      .connect-mark{width:44px;height:44px;display:grid;place-items:center;background:#0d2b22;color:#55d9b0;font-weight:800;margin-bottom:40px}
      .eyebrow{font:700 11px/1.2 ui-monospace,monospace;letter-spacing:.18em;color:#087d61;margin:18px 0}
      h1{font-size:clamp(42px,8vw,72px);line-height:.92;letter-spacing:-.06em;margin:0 0 22px} p{font-size:17px;line-height:1.65;color:#526b62}
      .connect-safety{display:flex;gap:10px;align-items:center;border:1px solid #d5e9e2;background:#eff9f5;padding:14px;margin:28px 0;color:#31584b}
      button{width:100%;border:0;background:#0d2b22;color:white;padding:17px 20px;font-weight:750;cursor:pointer}button:disabled{opacity:.6}.connect-error{color:#a03b2c}
    `}</style>
  </main>;
}
