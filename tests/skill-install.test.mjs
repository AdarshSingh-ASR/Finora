import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const productionUrl = "https://finora.finora-asr.workers.dev";

test("downloaded skill installs globally and configures the production service", async () => {
  const root = await mkdtemp(join(tmpdir(), "finora-skill-"));
  const codexHome = join(root, "codex");
  const agentsHome = join(root, "agents", "skills");
  const claudeHome = join(root, "claude", "commands");
  const configHome = join(root, "config");
  try {
    await execFileAsync(process.execPath, [fileURLToPath(new URL("../skills/finora-finance/scripts/install.mjs", import.meta.url))], {
      env: { ...process.env, CODEX_HOME: codexHome, AGENTS_HOME: agentsHome, CLAUDE_COMMANDS_HOME: claudeHome, FINORA_CONFIG_DIR: configHome },
    });
    await stat(join(codexHome, "skills", "finora-finance", "SKILL.md"));
    await stat(join(agentsHome, "finora-finance", "SKILL.md"));
    await stat(join(claudeHome, "finance.md"));
    const config = JSON.parse(await readFile(join(configHome, "agent-skill.json"), "utf8"));
    assert.equal(config.baseUrl, productionUrl);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the standalone client defaults to production instead of localhost", async () => {
  const client = await readFile(new URL("../skills/finora-finance/scripts/finora.mjs", import.meta.url), "utf8");
  assert.match(client, /https:\/\/finora\.finora-asr\.workers\.dev/);
  assert.doesNotMatch(client, /FINORA_API_URL \|\| "http:\/\/localhost/);
});
