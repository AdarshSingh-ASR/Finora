#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentRoot = process.env.AGENTS_HOME || join(homedir(), ".agents", "skills");
const agentTarget = join(agentRoot, "finora-finance");
const codexRoot = process.env.CODEX_HOME || join(homedir(), ".codex");
const codexTarget = join(codexRoot, "skills", "finora-finance");
const claudeCommands = process.env.CLAUDE_COMMANDS_HOME || join(homedir(), ".claude", "commands");

await mkdir(agentRoot, { recursive: true });
if (resolve(agentTarget) !== skillRoot) await cp(skillRoot, agentTarget, { recursive: true, force: true });
await mkdir(join(codexRoot, "skills"), { recursive: true });
if (resolve(codexTarget) !== skillRoot) await cp(skillRoot, codexTarget, { recursive: true, force: true });
await mkdir(claudeCommands, { recursive: true });
await writeFile(join(claudeCommands, "finance.md"), await readFile(join(skillRoot, "commands", "finance.md"), "utf8"));

const baseUrl = new URL(process.argv[2] || process.env.FINORA_API_URL || "https://finora.finora-asr.workers.dev").origin;
const configDir = process.env.FINORA_CONFIG_DIR || join(homedir(), ".finora");
let existing = {};
try { existing = JSON.parse((await readFile(join(configDir, "agent-skill.json"), "utf8")).replace(/^\uFEFF/, "")); } catch {}
await mkdir(configDir, { recursive: true });
await writeFile(join(configDir, "agent-skill.json"), `${JSON.stringify({ ...existing, baseUrl }, null, 2)}\n`, { mode: 0o600 });

process.stdout.write(`Installed Finora Finance skill:\n- Codex: ${codexTarget}\n- Agent Skills: ${agentTarget}\n- Claude command: ${join(claudeCommands, "finance.md")}\n- Server: ${baseUrl}\n`);
