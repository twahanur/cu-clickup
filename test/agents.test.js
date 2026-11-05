import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { skill } from "../scripts/build-skill.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CU = path.join(ROOT, "bin", "cu.js");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cusync-test-"));

function mcp(messages, env, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [CU, "mcp"], { cwd, env: { ...process.env, ...env } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("close", () => resolve(out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))));
    for (const m of messages) p.stdin.write(`${JSON.stringify(m)}\n`);
    p.stdin.end();
  });
}

test("skills/clickup/SKILL.md matches the rules in lib/cu.js (run npm run build:skill)", () => {
  assert.equal(fs.readFileSync(path.join(ROOT, "skills", "clickup", "SKILL.md"), "utf8"), skill);
});

test("plugin manifests are valid JSON and agree on the version", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
  const market = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "marketplace.json"), "utf8"));
  JSON.parse(fs.readFileSync(path.join(ROOT, "hooks", "hooks.json"), "utf8"));
  assert.equal(plugin.version, pkg.version);
  assert.equal(market.plugins[0].version, pkg.version);
  assert.equal(plugin.name, market.plugins[0].name);
});

test("MCP server: handshake, tool list, and a clear answer when not set up", async () => {
  const conf = tmp(), cwd = tmp();
  const res = await mcp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "clickup_where", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "clickup_plan_day", arguments: { titles: [] } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope", arguments: {} } },
    { jsonrpc: "2.0", id: 6, method: "nope" },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "clickup_where", arguments: { repo_path: "relative/path" } } },
  ], { CU_CONFIG_DIR: conf, CLICKUP_API_TOKEN: "" }, cwd);
  const by = Object.fromEntries(res.map((r) => [r.id, r]));
  assert.equal(res.length, 7, "one reply per request, none for the notification");
  assert.equal(by[1].result.serverInfo.name, "cusync");
  assert.equal(by[1].result.protocolVersion, "2025-06-18");
  assert.match(by[1].result.instructions, /clickup_start_task/);
  const names = by[2].result.tools.map((t) => t.name);
  for (const n of ["clickup_plan_day", "clickup_start_task", "clickup_finish_task", "clickup_team", "clickup_comment"]) assert.ok(names.includes(n), n);
  assert.ok(by[2].result.tools.every((t) => t.inputSchema.type === "object" && !("run" in t)));
  assert.equal(by[3].result.isError, true);
  assert.match(by[3].result.content[0].text, /npx cusync/);
  assert.equal(by[4].result.isError, true);
  assert.equal(by[5].error.code, -32602);
  assert.equal(by[6].error.code, -32601);
  assert.match(by[7].result.content[0].text, /absolute/);
});

test("session-start hook: silent outside git, a hint in an unlinked repo, Claude and Cursor formats", () => {
  const conf = tmp(), plain = tmp(), repo = tmp();
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const run = (cwd, env = {}) => execFileSync(process.execPath, [CU, "hook", "session-start"],
    { cwd, encoding: "utf8", env: { ...process.env, CU_CONFIG_DIR: conf, CURSOR_PLUGIN_ROOT: "", ...env } });
  assert.equal(run(plain), "");
  const claude = JSON.parse(run(repo));
  assert.equal(claude.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(claude.hookSpecificOutput.additionalContext, /npx cusync/);
  const cursor = JSON.parse(run(repo, { CURSOR_PLUGIN_ROOT: "/x" }));
  assert.match(cursor.additional_context, /not linked/);
});
