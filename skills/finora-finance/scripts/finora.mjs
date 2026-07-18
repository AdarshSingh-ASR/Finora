#!/usr/bin/env node
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

const configDir = process.env.FINORA_CONFIG_DIR || join(homedir(), ".finora");
const configPath = join(configDir, "agent-skill.json");
const defaultBaseUrl = process.env.FINORA_API_URL || "https://finora.finora-asr.workers.dev";

async function readConfig() {
  try {
    const config = JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
    return { ...config, baseUrl: config.baseUrl || defaultBaseUrl };
  } catch { return { baseUrl: defaultBaseUrl }; }
}
async function saveConfig(config) {
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try { await chmod(configPath, 0o600); } catch {}
}
function output(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
async function parsePayload(parts) {
  if (!parts.length) return {};
  if (parts.length === 1 && parts[0].startsWith("@")) return JSON.parse((await readFile(resolve(parts[0].slice(1)), "utf8")).replace(/^\uFEFF/, ""));
  if (parts.every((part) => part.includes("="))) return Object.fromEntries(parts.map((part) => {
    const separator = part.indexOf("="); const key = part.slice(0, separator); const raw = part.slice(separator + 1);
    let value; try { value = JSON.parse(raw); } catch { value = raw; }
    return [key, value];
  }));
  return JSON.parse(parts.join(" "));
}
async function request(path, config, init = {}) {
  let response;
  try {
    response = await fetch(`${config.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {}), ...init.headers },
    });
  } catch {
    throw new Error(`Finora could not reach ${config.baseUrl}. Check your internet connection or run configure with another Finora deployment URL.`);
  }
  const text = await response.text();
  let result; try { result = text ? JSON.parse(text) : {}; } catch { result = { error: text || `HTTP ${response.status}` }; }
  return { response, result };
}
async function beginAuth(config) {
  const { response, result } = await request("/api/agent-auth/start", config, { method: "POST", body: "{}" });
  if (!response.ok) throw new Error(result.error || "Could not start Finora authentication.");
  config.pendingDeviceCode = result.deviceCode;
  config.pendingVerificationUrl = result.verificationUrl;
  await saveConfig(config);
  return { status: "authentication_required", verificationUrl: result.verificationUrl, expiresIn: result.expiresIn, message: "Open the link, sign in with Google, approve Finora, then run skill-sync again." };
}
async function exchange(config) {
  if (!config.pendingDeviceCode) return null;
  const { response, result } = await request("/api/agent-auth/token", config, { method: "POST", body: JSON.stringify({ deviceCode: config.pendingDeviceCode, name: "Finora Agent Skill" }) });
  if (response.status === 428) return { status: "authentication_pending", verificationUrl: config.pendingVerificationUrl, message: "Approval is still pending." };
  if (!response.ok) { delete config.pendingDeviceCode; delete config.pendingVerificationUrl; await saveConfig(config); return null; }
  config.accessToken = result.accessToken;
  delete config.pendingDeviceCode; delete config.pendingVerificationUrl;
  await saveConfig(config);
  return { status: "connected" };
}
async function authenticated(config, path, init = {}) {
  if (!config.accessToken) {
    const exchanged = await exchange(config);
    if (!config.accessToken) return exchanged || beginAuth(config);
  }
  const value = await request(path, config, init);
  if (value.response.status === 401) { delete config.accessToken; await saveConfig(config); return beginAuth(config); }
  return value.result;
}

const [command = "skill-sync", ...args] = process.argv.slice(2);
const config = await readConfig();
try {
  if (command === "configure") {
    const url = new URL(args[0]); config.baseUrl = url.origin; delete config.accessToken; delete config.pendingDeviceCode; await saveConfig(config);
    output({ status: "configured", baseUrl: config.baseUrl });
  } else if (command === "skill-sync") {
    output(await authenticated(config, "/api/agent", { method: "POST", body: JSON.stringify({ action: "skill_sync" }) }));
  } else if (command === "call") {
    const action = args[0]; if (!action) throw new Error("Usage: finora.mjs call <action> [key=value ... | json | @payload.json]");
    const payload = await parsePayload(args.slice(1));
    output(await authenticated(config, "/api/agent", { method: "POST", body: JSON.stringify({ action, ...payload }) }));
  } else if (command === "ask") {
    const question = args.join(" ").trim(); if (!question) throw new Error("Usage: finora.mjs ask <question>");
    output(await authenticated(config, "/api/agent", { method: "POST", body: JSON.stringify({ action: "answer_finance_question", question }) }));
  } else if (command === "upload") {
    const filePath = resolve(args[0] || ""); if (!args[0]) throw new Error("Usage: finora.mjs upload <file> [--replace]");
    const data = await readFile(filePath); if (data.byteLength > 18 * 1024 * 1024) throw new Error("The statement exceeds the 18 MB skill upload limit.");
    const extension = extname(filePath).toLowerCase();
    const mime = { ".pdf": "application/pdf", ".csv": "text/csv", ".txt": "text/plain", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xls": "application/vnd.ms-excel", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extension] || "application/octet-stream";
    const textual = [".csv", ".txt"].includes(extension);
    const payload = { action: "sync_statement", filename: basename(filePath), mimeType: mime, replace: args.includes("--replace"), syncSheets: false, ...(textual ? { text: data.toString("utf8") } : { fileData: `data:${mime};base64,${data.toString("base64")}` }) };
    output(await authenticated(config, "/api/agent", { method: "POST", body: JSON.stringify(payload) }));
  } else if (command === "logout") {
    if (config.accessToken) await request("/api/agent-auth/token", config, { method: "DELETE" });
    delete config.accessToken; delete config.pendingDeviceCode; delete config.pendingVerificationUrl; await saveConfig(config); output({ status: "disconnected" });
  } else throw new Error(`Unknown command: ${command}`);
} catch (error) { output({ status: "error", error: error instanceof Error ? error.message : String(error) }); process.exitCode = 1; }
