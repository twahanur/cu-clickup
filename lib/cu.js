// cu: ClickUp from the terminal and from git, for any project. No dependencies (Node >= 18).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8"));
export const CONF_DIR = process.env.CU_CONFIG_DIR || path.join(os.homedir(), ".config", "clickup");
const API = apiBase(process.env.CU_API_BASE);

/** Only ClickUp, or a local test server, ever receives the token. */
export function apiBase(override) {
  if (!override) return "https://api.clickup.com/api/v2";
  try {
    const u = new URL(override);
    if (["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return override.replace(/\/+$/, "");
  } catch {}
  throw new Error(`CU_API_BASE must point to localhost (it is only for tests): ${override}`);
}

/** ClickUp ids that go into API paths: digits for spaces/workspaces/lists, [0-9a-z] for tasks. */
export const isId = (v) => typeof v === "string" && /^[0-9a-z]{1,40}$/i.test(v);
function checkId(v, what) {
  if (!isId(String(v))) throw new CuError(`Invalid ${what} id: ${JSON.stringify(v)}`);
  return String(v);
}

/** Quote a value for /bin/sh. */
export const shQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
const F = {
  token: path.join(CONF_DIR, "token"),
  config: path.join(CONF_DIR, "config.json"),
  state: path.join(CONF_DIR, "state.json"),
  queue: path.join(CONF_DIR, "queue.json"),
  legacy: path.join(CONF_DIR, "project.json"),
  hooks: path.join(CONF_DIR, "hooks"),
};

export const VERSION = PKG.version;
export const USAGE = `cu ${PKG.version}: ClickUp from the terminal and from git, for any project.

Setup: run \`cu setup\` inside a repo (or just \`cu\`). It walks you through everything:
  your ClickUp token (first time), which space the repo belongs to, your own list "👤 <your name>",
  git hooks, and CLAUDE.local.md (git-ignored) so Claude Code keeps ClickUp up to date.
  Something wrong? \`cu doctor\` checks everything and tells you the fix.

A task <ref> is a ClickUp id (86ex1abcd or CU-86ex1abcd), "." for the current task, or part of its name.

Daily flow:
  cu today "<title>" ["<title>" ...] [--due D] [--priority P] [--list L]
                                         plan the day: each title becomes a task in todo
  cu start [<ref | "new title">] [--due D] [--priority P] [--parent REF]
                                         in progress + current + timer (no argument: pick from a list)
  cu comment [<ref>] <text>              note progress (default: current task)
  cu finish [summary]                    comment the summary, move to in review, stop the timer
  cu block <text>                        current task -> blocked, with what you wait for
  cu pause                               stop the timer, keep the task current
  cu handoff <person> ["note"] [--task REF]   give your task to a teammate
  cu report [--date YYYY-MM-DD] [--slack] [--clickup]   what you did today
  Due dates: today, tomorrow, mon..sun, +3d, +1w, YYYY-MM-DD · priorities: urgent, high, normal, low

AI agents (Claude Code, Cursor, Codex, Copilot, Windsurf...):
  cu agents                              connect your AI tools so they keep ClickUp in sync for you
  cu mcp                                 run the MCP server (AI tools start this themselves)

Look around:
  cu team                                who is working on what in this space right now
  cu mine [--all] | current | show <ref> | where | lists | statuses

Other:
  cu setup [--space S] [--token pk_..]   switch this repo's space or change the token
                                         (prefer the prompt: a --token value stays in your shell history)
  cu add <title> [--list L] [--parent REF] [--desc D]
  cu status <ref> <status>               todo / in progress / in review / done ... matched to the space's names
  cu pr [<ref>] <url>                    set the PR link field (if any) and move to in review
  cu bug <title> [description]           a bug in the space's bug list (or your own list)
  cu tasks [file]                        all my tasks in this space as a Markdown checklist
  cu config [name] [value]               settings: lang (en|bn), timer, commit_tag, update_check, slack_webhook, token_store
  cu github-action                       team workflow: a merged PR moves its CU-<id> tasks to done
  cu completion bash|zsh|fish            tab completion (add: eval "$(cu completion bash)" to your shell rc)
  cu version

Git hooks: commit messages get CU-<id> of the current task; each commit is logged on that task, else on today's
catch-all task "🗒 <name>: Other work <date>" (amended and rebased commits are not logged twice). Offline, logs are queued in ${CONF_DIR}/queue.json and
sent by the next commit or cu command.`;

export class CuError extends Error {}
export class Offline extends CuError {}
/** Missing token or repo not linked: `cu setup` fixes it. */
export class NeedsSetup extends CuError {}
/** No task matches a reference. */
export class NotFound extends CuError {}
class Usage extends Error {}

const INSTALL_SPEC = PKG.cuInstall || PKG.name;
const TOKEN_URL = "https://app.clickup.com/settings/apps";
const interactive = () => !!(process.stdin.isTTY && process.stdout.isTTY);
const viaNpx = () => HERE.split(path.sep).includes("_npx");

// ── plumbing ────────────────────────────────────────────────────────────────
let tokenOverride = null;
let keychainToken = null;
function token() {
  let tok = tokenOverride || process.env.CLICKUP_API_TOKEN;
  if (!tok && config().token_store === "keychain") {
    keychainToken ??= keychain.get();
    if (!keychainToken) throw new Offline("could not read the ClickUp token from the system keychain (locked?)");
    tok = keychainToken;
  }
  if (!tok && fs.existsSync(F.token)) tok = fs.readFileSync(F.token, "utf8").trim();
  if (!tok) throw new NeedsSetup("cu is not set up yet (no ClickUp token).");
  return tok;
}

export const looksLikeToken = (t) => /^pk_[A-Za-z0-9_]{10,}$/.test(t);
const hasToken = () => !!(process.env.CLICKUP_API_TOKEN || config().token_store === "keychain" || fs.existsSync(F.token));

/** The system keychain (macOS Keychain, Linux Secret Service). The token never appears on a command line. */
const KC_SERVICE = process.env.CU_KEYCHAIN_SERVICE || "clickup-flow";
export const keychain = {
  tool() {
    if (process.platform === "darwin" && onPath("security")) return "security";
    if (process.platform === "linux" && onPath("secret-tool")) return "secret-tool";
    return null;
  },
  get() {
    try {
      if (this.tool() === "security")
        return execFileSync("security", ["find-generic-password", "-s", KC_SERVICE, "-a", "clickup", "-w"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 }).trim() || null;
      if (this.tool() === "secret-tool")
        return execFileSync("secret-tool", ["lookup", "service", KC_SERVICE, "account", "clickup"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 }).trim() || null;
    } catch {}
    return null;
  },
  set(tok) {
    if (!looksLikeToken(tok)) return false;
    let r;
    if (this.tool() === "security")
      r = spawnSync("security", ["-i"], { input: `add-generic-password -U -s ${KC_SERVICE} -a clickup -w ${tok}\n`, stdio: ["pipe", "ignore", "ignore"], timeout: 15000 });
    else if (this.tool() === "secret-tool")
      r = spawnSync("secret-tool", ["store", "--label=clickup-flow ClickUp token", "service", KC_SERVICE, "account", "clickup"],
        { input: tok, stdio: ["pipe", "ignore", "ignore"], timeout: 15000 });
    else return false;
    return r.status === 0 && this.get() === tok;
  },
  del() {
    if (this.tool() === "security") spawnSync("security", ["delete-generic-password", "-s", KC_SERVICE, "-a", "clickup"], { stdio: "ignore" });
    if (this.tool() === "secret-tool") spawnSync("secret-tool", ["clear", "service", KC_SERVICE, "account", "clickup"], { stdio: "ignore" });
  },
};

/** Save a working token: in the keychain when the user chose it, else in a 600 file. */
function saveToken(tok, where) {
  const conf = config();
  if (where === "keychain" && keychain.set(tok)) {
    keychainToken = tok;
    try {
      fs.unlinkSync(F.token);
    } catch {}
    saveConfig({ ...conf, token_store: "keychain" });
    return "keychain";
  }
  privateDir(CONF_DIR);
  fs.writeFileSync(F.token, `${tok}\n`, { mode: 0o600 });
  fs.chmodSync(F.token, 0o600);
  if (conf.token_store === "keychain") {
    keychain.del();
    delete conf.token_store;
    saveConfig(conf);
  }
  return "file";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let inHook = false;

export async function api(method, p, body) {
  const maxWait = inHook ? 3000 : 30000; // a git hook must not hold the terminal for long
  const auth = token(); // outside the try: a missing token is not a network problem
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${API}/${p}`, {
        method,
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      throw new Offline(`ClickUp unreachable: ${e.cause?.code || e.name || e.message}`);
    }
    // 429: ClickUp allows about 100 requests a minute. Nothing was done, so any method can be retried.
    // 5xx: retried for reads only, so a create is never sent twice.
    const retriable = res.status === 429 || (res.status >= 500 && method === "GET");
    if (retriable && attempt < 3) {
      const after = Number(res.headers.get("retry-after")) * 1000;
      const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000 - Date.now();
      const wait = res.status === 429 ? (after || (reset > 0 ? reset : 0) || 5000) : 1000 * (attempt + 1);
      if (wait <= maxWait) {
        if (res.status === 429 && !inHook) console.error(`(ClickUp rate limit: waiting ${Math.ceil(wait / 1000)}s)`);
        await res.text().catch(() => {});
        await sleep(Math.max(wait, 250));
        continue;
      }
    }
    if (res.status === 429) throw new Offline("ClickUp rate limit reached (about 100 requests a minute); try again shortly");
    const txt = await res.text();
    if (!res.ok) throw new CuError(`ClickUp ${method} ${p}: ${res.status} ${txt.slice(0, 300)}`);
    return txt ? JSON.parse(txt) : {};
  }
}

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function readJson(file, dflt) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return dflt;
  }
}

function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    if (dir === CONF_DIR) fs.chmodSync(dir, 0o700);
  } catch {}
}

function writeJson(file, data) {
  privateDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const config = () => readJson(F.config, {});
/** User settings with defaults (cu config). */
export const SETTINGS = {
  lang: { values: ["en", "bn"], dflt: "en", help: "language of task names and reports cu writes (en, bn)" },
  timer: { values: ["on", "off"], dflt: "on", help: "start/stop ClickUp time tracking with cu start / finish" },
  commit_tag: { values: ["on", "off"], dflt: "on", help: "add CU-<id> of the current task to commit messages" },
  update_check: { values: ["on", "off"], dflt: "on", help: "tell you once a day when a new clickup-flow is out" },
  slack_webhook: { values: null, dflt: "", help: "Slack incoming webhook URL for cu report --slack (or off)" },
  token_store: { values: ["file", "keychain"], dflt: "file", help: "where the token is kept (keychain: macOS / Linux)" },
};
const setting = (k) => config()[k] ?? SETTINGS[k].dflt;

export const I18N = {
  en: { other: "Other work", report: "Daily report", finished: "Finished", working: "In progress", blocked: "Blocked",
    planned: "Planned", handed: "Handed over", commits: "Commits", nothing: "Nothing recorded for this day.",
    tasksOf: "Tasks of", made: "Made from ClickUp", regen: "Make again", total: "total", doneW: "done", left: "left" },
  bn: { other: "অন্যান্য কাজ", report: "দিনের রিপোর্ট", finished: "শেষ হয়েছে", working: "চলছে", blocked: "আটকে আছে",
    planned: "পরিকল্পনা", handed: "হস্তান্তর", commits: "Commit", nothing: "এই দিনের কোনো রেকর্ড নেই।",
    tasksOf: "কাজের তালিকা:", made: "ClickUp থেকে তৈরি", regen: "আবার তৈরি করতে", total: "মোট", doneW: "শেষ", left: "বাকি" },
};
const t = (k) => (I18N[setting("lang")] || I18N.en)[k];

/** "today", "tomorrow", "fri", "+3d", "2026-11-20" -> ClickUp due_date (ms, local noon). */
export function parseDue(s, now = new Date()) {
  if (!s) return null;
  const v = String(s).trim().toLowerCase();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  let m;
  if (v === "today") return d.getTime();
  if (v === "tomorrow") return d.setDate(d.getDate() + 1);
  if ((m = /^\+(\d{1,3})d$/.exec(v))) return d.setDate(d.getDate() + Number(m[1]));
  if ((m = /^\+(\d{1,2})w$/.exec(v))) return d.setDate(d.getDate() + 7 * Number(m[1]));
  const full = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const wd = days.indexOf(v) >= 0 ? days.indexOf(v) : full.indexOf(v);
  if (wd >= 0) return d.setDate(d.getDate() + (((wd - d.getDay() + 7) % 7) || 7));
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v))) {
    const x = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    if (x.getMonth() === Number(m[2]) - 1) return x.getTime();
  }
  throw new CuError(`Could not read the due date "${s}". Use today, tomorrow, mon..sun, +3d, +1w or YYYY-MM-DD.`);
}

/** urgent/high/normal/low or 1-4 -> ClickUp priority number. */
export function parsePriority(s) {
  if (!s) return null;
  const v = String(s).trim().toLowerCase();
  const n = { urgent: 1, high: 2, normal: 3, low: 4 }[v] ?? (/^[1-4]$/.test(v) ? Number(v) : null);
  if (!n) throw new CuError(`Unknown priority "${s}". Use urgent, high, normal or low.`);
  return n;
}

/** a > b for x.y.z versions. */
export function newer(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}
const saveConfig = (c) => writeJson(F.config, c);
// An older single-project install kept the space in project.json; it still works for repos not yet linked.
const LEGACY = readJson(F.legacy, {});

let _me;
async function me() {
  _me ??= (await api("GET", "user")).user;
  return _me;
}

// ── which space: per repo (git config clickup.space), else last setup, else legacy project.json ────────────
export function spaceIds() {
  const root = git("rev-parse", "--show-toplevel");
  let space, ws;
  if (root) [space, ws] = [git("config", "--get", "clickup.space"), git("config", "--get", "clickup.workspace")];
  if (!space && LEGACY.space_id && (root || !config().default_space)) [space, ws] = [LEGACY.space_id, LEGACY.workspace_id];
  if (!space && !root) [space, ws] = [config().default_space, config().default_workspace];
  if (!space) throw new NeedsSetup(root ? `${path.basename(root)} is not linked to a ClickUp space yet.` : "No ClickUp space chosen yet.");
  return [checkId(space, "space"), checkId(ws, "workspace")];
}

let _ctx;
async function ctx() {
  if (_ctx) return _ctx;
  const [space, workspace] = spaceIds();
  const sp = await api("GET", `space/${space}`);
  _ctx = {
    space, workspace, name: sp.name,
    statuses: (sp.statuses || []).map((s) => ({ name: s.status.toLowerCase(), type: s.type || "" })),
  };
  return _ctx;
}

/** Map todo / in progress / in review / blocked / done onto a space's own status names. */
export function statusName(want, statuses) {
  const w = want.toLowerCase().trim();
  if (statuses.some((s) => s.name === w)) return w;
  const first = (pred) => statuses.find(pred)?.name ?? null;
  if (["todo", "to do", "open", "backlog"].includes(w))
    return first((s) => s.type === "open") ?? first((s) => s.name.includes("to do") || s.name.includes("todo"));
  if (w.includes("progress")) return first((s) => s.name.includes("progress")) ?? first((s) => s.type === "custom");
  if (w.includes("review")) return first((s) => s.name.includes("review"));
  if (w.includes("block")) return first((s) => s.name.includes("block"));
  if (["done", "complete", "completed", "closed"].includes(w))
    return first((s) => s.type === "done") ?? first((s) => s.type === "closed");
  return null;
}

const status = async (want) => statusName(want, (await ctx()).statuses);

async function setStatus(tid, want, strict = false) {
  const name = await status(want);
  if (!name) {
    const msg = `This space has no "${want}" status (it has: ${(await ctx()).statuses.map((s) => s.name).join(", ")})`;
    if (strict) throw new CuError(msg);
    console.log(`(status unchanged: ${msg})`);
    return null;
  }
  await api("PUT", `task/${checkId(tid, "task")}`, { status: name });
  return name;
}

// ── current task (one per space), daily catch-all task ──────────────────────
function state() {
  const st = readJson(F.state, {});
  if (st.current && st.current.id) st.current = { [LEGACY.space_id || "?"]: st.current }; // old single-project format
  return st;
}

const current = () => state().current?.[spaceIds()[0]] ?? null;

function setCurrent(t) {
  const st = state();
  st.current ??= {};
  if (t) st.current[spaceIds()[0]] = { id: t.id, name: t.name, url: t.url, since: new Date().toISOString() };
  else delete st.current[spaceIds()[0]];
  writeJson(F.state, st);
}

const today = () => new Date().toLocaleDateString("sv"); // YYYY-MM-DD, local time

/** A local diary of what happened today (for cu report). Kept 14 days, never sent anywhere by itself. */
function journal(kind, task, text = "") {
  try {
    const st = state();
    st.journal ??= {};
    const day = today();
    (st.journal[day] ??= []).push({ at: new Date().toTimeString().slice(0, 5), kind, space: git("config", "--get", "clickup.spacename") || "",
      task: task ? { id: task.id, name: task.name } : null, text: String(text).slice(0, 300) });
    for (const d of Object.keys(st.journal).sort().slice(0, -14)) delete st.journal[d];
    writeJson(F.state, st);
  } catch {}
}

/** Build the day's report from the journal. Pure, so it can be tested. */
export function buildReport(entries, who, day, tr = I18N.en) {
  if (!entries?.length) return `## ${tr.report} · ${who} · ${day}\n\n${tr.nothing}`;
  const by = (k) => entries.filter((e) => e.kind === k);
  const finished = new Map(by("finish").map((e) => [e.task?.id, e]));
  const handed = new Map(by("handoff").map((e) => [e.task?.id, e]));
  const blocked = new Map(by("block").filter((e) => !finished.has(e.task?.id)).map((e) => [e.task?.id, e]));
  const working = new Map(by("start").filter((e) => !finished.has(e.task?.id) && !handed.has(e.task?.id) && !blocked.has(e.task?.id)).map((e) => [e.task?.id, e]));
  const commits = by("commit");
  const out = [`## ${tr.report} · ${who} · ${day}`, ""];
  const section = (title, rows) => rows.length && out.push(`**${title}**`, ...rows, "");
  section(tr.finished, [...finished.values()].map((e) => `- ${e.task.name}${e.text ? `: ${e.text}` : ""}`));
  section(tr.working, [...working.values()].map((e) => `- ${e.task.name} (${e.at})`));
  section(tr.blocked, [...blocked.values()].map((e) => `- ${e.task.name}: ${e.text}`));
  section(tr.handed, [...handed.values()].map((e) => `- ${e.task.name} → ${e.text}`));
  section(tr.planned, by("plan").map((e) => `- ${e.task?.name || e.text}`));
  section(`${tr.commits} (${commits.length})`, commits.map((e) => `- ${e.at} ${e.text}${e.task ? ` · ${e.task.name}` : ""}`));
  return out.join("\n").trim();
}

async function dailyTask() {
  const sp = spaceIds()[0];
  const d = state().daily?.[sp];
  if (d && d.date === today()) return d;
  const name = `🗒 ${(await me()).username.split(" ")[0]}: ${t("other")} ${today()}`;
  const t = (await myTasks(true)).find((x) => x.name === name) ?? (await create(name, "in progress"));
  const st = state();
  st.daily ??= {};
  st.daily[sp] = { date: today(), id: t.id, name: t.name };
  writeJson(F.state, st);
  return st.daily[sp];
}

// ── offline queue ───────────────────────────────────────────────────────────
function enqueue(space, task, text) {
  const q = readJson(F.queue, []);
  q.push({ space, task, text, at: new Date().toISOString().slice(0, 16) });
  writeJson(F.queue, q);
}

async function flushQueue() {
  const q = readJson(F.queue, []);
  if (!q.length) return 0;
  let here = null;
  try {
    here = spaceIds()[0];
  } catch {}
  const keep = [];
  let sent = 0;
  for (let i = 0; i < q.length; i++) {
    const e = q[i];
    try {
      let tid = e.task;
      if (!tid) {
        if (e.space !== here) { keep.push(e); continue; } // its daily task lives in another space
        tid = (await dailyTask()).id;
      }
      await comment(tid, `${e.text}\n(saved offline at ${e.at})`);
      sent++;
    } catch (err) {
      if (err instanceof Offline) { keep.push(...q.slice(i)); break; }
      if (err instanceof CuError) console.error(`[clickup] dropped a saved log (${err.message})`);
      else throw err;
    }
  }
  writeJson(F.queue, keep);
  if (sent) console.log(`[clickup] sent ${sent} saved commit log(s)${keep.length ? `, ${keep.length} still waiting` : ""}`);
  return sent;
}

// ── lists and tasks ─────────────────────────────────────────────────────────
async function allLists() {
  const sp = (await ctx()).space;
  const out = [];
  for (const fo of (await api("GET", `space/${sp}/folder?archived=false`)).folders)
    out.push(...fo.lists.map((l) => ({ id: l.id, name: l.name, folder: fo.name })));
  out.push(...(await api("GET", `space/${sp}/list?archived=false`)).lists.map((l) => ({ id: l.id, name: l.name, folder: "" })));
  return out;
}

async function findList(nameOrId) {
  const lists = await allLists();
  if (lists.some((l) => l.id === nameOrId)) return nameOrId;
  const hits = lists.filter((l) => l.name.toLowerCase().includes(nameOrId.toLowerCase()));
  if (hits.length === 1) return hits[0].id;
  if (!hits.length) throw new CuError(`No list matches "${nameOrId}". Run \`cu lists\`.`);
  throw new CuError(`"${nameOrId}" matches several lists: ${hits.map((l) => l.name).join(", ")}`);
}

/** My own list "👤 <name>" in this space, created on first use, so the list shows who works on what. */
async function myList() {
  const sp = (await ctx()).space;
  const conf = config();
  conf.lists ??= {};
  if ("default_list" in conf) { // older config: one list, in the legacy space
    if (LEGACY.space_id && !conf.lists[LEGACY.space_id]) conf.lists[LEGACY.space_id] = conf.default_list;
    delete conf.default_list;
    saveConfig(conf);
  }
  const known = await allLists();
  let lid = conf.lists[sp];
  if (!known.some((l) => l.id === lid)) {
    const name = `👤 ${(await me()).username}`;
    lid = known.find((l) => l.name === name)?.id ?? (await api("POST", `space/${sp}/list`, { name })).id;
    conf.lists[sp] = lid;
    saveConfig(conf);
  }
  return lid;
}

async function paged(query) {
  const rows = [];
  for (let page = 0; ; page++) {
    const r = await api("GET", `${query}&page=${page}`);
    rows.push(...r.tasks);
    if (r.last_page === true || r.tasks.length < 100 || page >= 50) return rows;
  }
}

async function myTasks(includeClosed = false) {
  const c = await ctx();
  return paged(`team/${c.workspace}/task?space_ids[]=${c.space}&assignees[]=${(await me()).id}&order_by=updated&subtasks=true`
    + (includeClosed ? "&include_closed=true" : ""));
}

const getTask = (tid) => api("GET", `task/${checkId(tid, "task")}`);

async function resolve(ref) {
  if (ref === ".") {
    const cur = current();
    if (!cur) throw new CuError(`No current task in "${(await ctx()).name}". Use \`cu start <ref | title>\`.`);
    return getTask(cur.id);
  }
  const m = /^(?:CU-)?([0-9a-z]{7,12})$/i.exec(ref);
  if (m && /\d/.test(m[1])) {
    try {
      return await getTask(m[1]);
    } catch (e) {
      if (e instanceof Offline) throw e; // otherwise: not an id after all, try it as text
    }
  }
  const q = ref.toLowerCase();
  let hits = (await myTasks()).filter((t) => t.name.toLowerCase().includes(q));
  if (hits.length > 1) { // "Sync P1" should pick [Sync P1], not [Sync P10]
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const whole = hits.filter((t) => new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, "u").test(t.name.toLowerCase()));
    if (whole.length) hits = whole;
  }
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new NotFound(`No open task of mine in "${(await ctx()).name}" matches "${ref}"`);
  throw new CuError(`"${ref}" matches several tasks:\n${hits.slice(0, 10).map((t) => `  ${line(t)}`).join("\n")}`);
}

/** A ClickUp id written as CU-<id> in a branch name or commit message, or null. */
export function refFromText(text) {
  return /\bCU-([0-9a-z]{7,12})\b/i.exec(text)?.[1] ?? null;
}

/** ClickUp time tracking around cu start / finish (cu config timer off to disable). Never fails a command. */
async function timer(action, tid) {
  if (setting("timer") === "off") return;
  const ws = spaceIds()[1];
  try {
    if (action === "stop" || action === "start") await api("POST", `team/${ws}/time_entries/stop`).catch((e) => {
      if (e instanceof Offline) throw e; // "no timer running" is fine
    });
    if (action === "start") {
      await api("POST", `team/${ws}/time_entries/start`, { tid: checkId(tid, "task") });
      console.log("  ⏱ timer running");
    }
  } catch (e) {
    if (e instanceof Offline) throw e;
    console.log(`  (timer not started: ${e.message.slice(0, 120)}. Turn it off with: cu config timer off)`);
  }
}

const comment = (tid, text) => api("POST", `task/${checkId(tid, "task")}/comment`, { comment_text: text, notify_all: false });

async function create(title, st = "todo", listRef = null, parent = null, desc = null, extra = {}) {
  const body = { name: title, assignees: [(await me()).id] };
  if (extra.due) body.due_date = parseDue(extra.due);
  if (extra.priority) body.priority = parsePriority(extra.priority);
  const s = await status(st);
  if (s) body.status = s;
  if (desc) body.markdown_content = desc;
  let listId;
  if (parent) {
    const p = await resolve(parent);
    body.parent = p.id;
    listId = p.list.id; // ClickUp keeps a subtask in its parent's list
  } else listId = listRef ? await findList(listRef) : await myList();
  return api("POST", `list/${listId}/task`, body);
}

/** Split --name value options out of args. */
export function opts(args, ...names) {
  const pos = [], found = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && names.includes(args[i].slice(2))) found[args[i].slice(2)] = args[++i] ?? null;
    else pos.push(args[i]);
  }
  return [pos, found];
}

const line = (t) => `${t.id}  ${t.name}`;

export function ago(ms, now = Date.now()) {
  const s = Math.floor((now - Number(ms)) / 1000);
  if (!Number.isFinite(s)) return "?";
  for (const [u, size] of [["d", 86400], ["h", 3600], ["m", 60]]) if (s >= size) return `${Math.floor(s / size)}${u} ago`;
  return "just now";
}

function ask(question, hidden = false) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    let done = false;
    if (hidden && process.stdin.isTTY) rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (a) => { done = true; rl.close(); if (hidden) process.stdout.write("\n"); res(a.trim()); });
    rl.on("close", () => { if (!done) res(""); });
  });
}

async function confirm(question, dflt = true) {
  const a = (await ask(`${question} ${dflt ? "[Y/n]" : "[y/N]"} `)).toLowerCase();
  return a ? a.startsWith("y") : dflt;
}

function openUrl(url) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
    return true;
  } catch {
    return false;
  }
}

const onPath = (bin) => {
  const r = spawnSync(process.platform === "win32" ? "where" : "sh",
    process.platform === "win32" ? [bin] : ["-c", `command -v ${bin}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim().split(/\r?\n/)[0] : null;
};

/** Ask for a token until ClickUp accepts one (3 tries). Returns { tok, user }. */
async function askToken() {
  console.log(`
Step 1 of 2 · ClickUp token
  cu needs your personal ClickUp API token. It stays on this computer only.
  Where: ClickUp → your avatar (bottom left) → Settings → Apps → API Token → Generate / Copy`);
  if (await confirm("  Open that page in your browser now?")) {
    if (!openUrl(TOKEN_URL)) console.log(`  Open this link: ${TOKEN_URL}`);
  }
  for (let tries = 1; tries <= 3; tries++) {
    const tok = await ask("  Paste the token (starts with pk_, it will not be shown): ", true);
    if (!tok) {
      console.log("  Nothing pasted.");
      continue;
    }
    if (!looksLikeToken(tok)) {
      console.log("  ✖ That does not look like a ClickUp token: it starts with pk_. Copy it again.");
      continue;
    }
    tokenOverride = tok;
    _me = undefined;
    try {
      return { tok, user: await me() };
    } catch (e) {
      if (e instanceof Offline) throw e;
      console.log(`  ✖ ClickUp did not accept that token${tries < 3 ? ", try again (copy the whole token)." : "."}`);
    }
  }
  tokenOverride = null;
  throw new CuError("No valid token. Run `cu setup` again when you have it.");
}

// ── setup ───────────────────────────────────────────────────────────────────
const RULES_START = "<!-- clickup-flow:start -->", RULES_END = "<!-- clickup-flow:end -->";
const OLD_START = "<!-- clickup:start -->", OLD_END = "<!-- clickup:end -->";

/** What every AI coding agent should do in a repo linked to ClickUp. One text for Claude, Cursor, AGENTS.md, MCP. */
export const agentRules = (space) => `## ClickUp: keep it in sync without being asked

Work in this repo is tracked in ClickUp${space ? ` (space "${space}")` : ""} with **clickup-flow**. Keep ClickUp up to
date on your own while you work, for the developer you work with. Prefer the \`clickup_*\` MCP tools when you
have them; otherwise run the \`cu\` command in the terminal (\`cu\` alone prints usage). The token and config live in
\`~/.config/clickup/\`: never print the token and never copy that folder or this section into tracked files.

A task is referenced by its ClickUp id (\`86ex1abcd\`, or \`CU-86ex1abcd\` in a commit message), by part of its
name, or \`.\` for the current task.

| When | MCP tool | Terminal |
|---|---|---|
| The user lists the day's work ("today I'll do X and Y", "আজ এই এই কাজ করব") | \`clickup_my_tasks\` first, then \`clickup_plan_day\` | \`cu mine\`, then \`cu today "X" "Y"\` |
| Before you start a piece of work | \`clickup_start_task\` | \`cu start "<task or new title>"\` |
| A decision, a partial result, end of day | \`clickup_comment\` | \`cu comment "<done, left, blocking>"\` |
| The work is finished and tests pass | \`clickup_finish_task\` with a short summary | \`cu finish "<summary>"\` |
| A pull request is opened | \`clickup_pr\` | \`cu pr <url>\` |
| Waiting on someone or something | \`clickup_block_task\` | \`cu block "<what you wait for>"\` |
| A break, the work stays current | \`clickup_pause_timer\` | \`cu pause\` |
| The user gives the task to a teammate | \`clickup_handoff\` | \`cu handoff <person> "<note>"\` |
| End of day, or "what did I do today?" | \`clickup_daily_report\` | \`cu report\` |
| "Who is working on what?" ("কে কী করছে") | \`clickup_team\` | \`cu team\` |

Rules:
1. Do these yourself, without asking first, and tell the user in one short line what you changed in ClickUp.
2. \`start\` finds a matching task or creates one, so start the real task before writing code. Commits are logged by
   a git hook on the current task; with no current task they go to a catch-all task for the day. Pass a due date
   or priority only when the user mentions one (due: today, tomorrow, fri, +3d, 2026-12-01; priority: urgent,
   high, normal, low).
3. Write summaries and comments for the teammate who reads them: what changed, what is left, what blocks.
4. Never mark a task done unless the user confirms it is merged and tested. Never change another person's task.
5. If clickup-flow says the repo is not set up, ask the user to run \`npx clickup-flow\` in a terminal in this folder (it is
   interactive), then carry on. If ClickUp is unreachable, say so in one line and carry on with the code; never
   retry in a loop.
`;

/** Hook scripts in ~/.config/clickup/hooks that call this cu, wherever npm put it. */
function writeHooks() {
  fs.mkdirSync(F.hooks, { recursive: true });
  const script = fs.realpathSync(path.join(HERE, "..", "bin", "cu.js"));
  for (const ev of ["post-commit", "post-checkout", "prepare-commit-msg"]) {
    fs.writeFileSync(path.join(F.hooks, ev), `#!/bin/sh
# cu (ClickUp): log git activity on the current task. Never fails the git command.
if command -v cu >/dev/null 2>&1; then cu hook ${ev} "$@"
elif [ -x ${shQuote(process.execPath)} ] && [ -f ${shQuote(script)} ]; then ${shQuote(process.execPath)} ${shQuote(script)} hook ${ev} "$@"
fi
exit 0
`, { mode: 0o755 });
    fs.chmodSync(path.join(F.hooks, ev), 0o755);
  }
  // The older Python install put a `cu` symlink in ~/.local/bin that would shadow this one.
  const old = path.join(os.homedir(), ".local", "bin", "cu");
  try {
    if (fs.lstatSync(old).isSymbolicLink() && fs.readlinkSync(old).endsWith("cu.py")) {
      fs.unlinkSync(old);
      console.log("  ✔ removed the old Python `cu` from ~/.local/bin");
    }
  } catch {}
}

/** Write our rules into one agent file, never touching tracked files, symlinks or anything outside the repo. */
function writeRules(root, rel, body, whole = false) {
  const file = path.join(root, rel);
  if (gitTracked(root, rel)) return `${rel} (skipped: tracked by git)`;
  let stat = null;
  try {
    stat = fs.lstatSync(file);
  } catch {}
  if (stat && !stat.isFile()) return `${rel} (skipped: not a regular file)`;
  let text;
  if (whole) text = body;
  else {
    text = stat ? fs.readFileSync(file, "utf8") : "";
    const block = `${RULES_START}\n${body}${RULES_END}\n`;
    for (const [s0, e0] of [[RULES_START, RULES_END], [OLD_START, OLD_END]]) {
      const i = text.indexOf(s0), j = text.indexOf(e0);
      if (i >= 0 && j > i) {
        text = text.slice(0, i) + block.trimEnd() + text.slice(j + e0.length);
        break;
      }
      if (s0 === OLD_START) text = (text.trim() ? `${text.trimEnd()}\n\n` : "") + block;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  excludeFromGit(root, rel);
  return null;
}

function gitTracked(root, rel) {
  try {
    execFileSync("git", ["-C", root, "ls-files", "--error-unmatch", rel], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function excludeFromGit(root, rel) {
  let gitDir = git("-C", root, "rev-parse", "--git-common-dir") || ".git";
  if (!path.isAbsolute(gitDir)) gitDir = path.join(root, gitDir);
  const exclude = path.join(gitDir, "info", "exclude");
  const entry = `/${rel.split(path.sep).join("/")}`;
  const lines = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8").split(/\r?\n/) : [];
  if (!lines.includes(entry) && !lines.includes(rel)) {
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    fs.appendFileSync(exclude, `\n${entry}\n`);
  }
}

/** Hooks + AI rules for one repo, all kept out of git. */
function installRepo(root, spaceName) {
  git("-C", root, "config", "core.hooksPath", F.hooks);
  git("-C", root, "config", "clickup.spacename", spaceName);
  console.log(`  ✔ git hooks on in ${path.basename(root)}: every commit is logged`);
  const rules = agentRules(spaceName);
  const cursorRule = `---\ndescription: Keep ClickUp in sync with clickup-flow while working in this repo\nalwaysApply: true\n---\n\n${rules}`;
  const targets = [
    ["Claude Code", "CLAUDE.local.md", rules, false],
    ["Cursor", path.join(".cursor", "rules", "clickup-flow.mdc"), cursorRule, true],
    ["Codex, Copilot, Windsurf and other AGENTS.md agents", "AGENTS.md", rules, false],
  ];
  const done = [], skipped = [];
  for (const [who, rel, body, whole] of targets) {
    const why = writeRules(root, rel, body, whole);
    (why ? skipped : done).push(why || who);
  }
  if (done.length) console.log(`  ✔ AI rules for ${done.join("; ")} (not committed)`);
  for (const s of skipped) console.log(`    · ${s}`);
}

async function cmdSetup(...args) {
  const [pos, o] = opts(args, "space", "token");
  const flagTok = o.token || pos.find((a) => a.startsWith("pk_"));
  const root = git("rev-parse", "--show-toplevel");
  console.log(`\n👋 cu setup${root ? ` for ${path.basename(root)}` : ""}`);

  // 1. token: from the flag, the saved file, or asked for (with retries)
  let tok = null, user;
  if (flagTok) {
    if (!looksLikeToken(flagTok)) throw new CuError("That does not look like a ClickUp token (it starts with pk_).");
    tokenOverride = flagTok;
    _me = undefined;
    try {
      user = await me();
    } catch (e) {
      if (e instanceof Offline) throw e;
      throw new CuError("ClickUp did not accept that token. Copy it again from ClickUp → Settings → Apps.");
    }
    tok = flagTok;
  } else if (hasToken()) {
    _me = undefined;
    try {
      user = await me();
    } catch (e) {
      if (e instanceof Offline || !interactive()) throw e;
      console.log("  The saved token no longer works.");
    }
  }
  if (!user) {
    if (!interactive()) throw new NeedsSetup("No ClickUp token. Run `cu setup` in a terminal, or `cu setup --token pk_...`.");
    ({ tok, user } = await askToken());
  }
  if (tok) {
    let where = "file";
    if (keychain.tool() && interactive() && !flagTok)
      where = (await confirm("  Keep the token in your system keychain (safer than a file)?")) ? "keychain" : "file";
    const saved = saveToken(tok, where);
    if (where === "keychain" && saved !== "keychain") console.log("  (keychain not available, the token is kept in a private file)");
  }
  console.log(`  ✔ signed in as ${user.username}`);

  // 2. space
  let linked = root ? git("config", "--get", "clickup.space") : config().default_space;
  linked ||= root ? LEGACY.space_id : null;
  const choices = [];
  for (const team of (await api("GET", "team")).teams)
    for (const sp of (await api("GET", `team/${team.id}/space?archived=false`)).spaces)
      choices.push({ workspace: String(team.id), wsName: team.name.trim(), space: String(sp.id), name: sp.name });
  if (!choices.length) throw new CuError("Your ClickUp account cannot see any space. Ask a workspace admin to add you to one.");
  let pick;
  if (o.space) {
    const hits = choices.filter((c) => c.space === o.space || c.name.toLowerCase().includes(o.space.toLowerCase()));
    if (hits.length !== 1) throw new CuError(`--space "${o.space}" matches ${hits.length} spaces: ${hits.map((c) => c.name).join(", ") || "none"}`);
    pick = hits[0];
  } else if (choices.length === 1 || !interactive()) {
    pick = choices.find((c) => c.space === linked) || (choices.length === 1 ? choices[0] : null);
    if (!pick) throw new CuError(`Several spaces found. Choose one: cu setup --space "<name>"  (${choices.map((c) => c.name).join(", ")})`);
  } else {
    console.log(`\nStep 2 of 2 · Which ClickUp space is ${root ? path.basename(root) : "your work"} tracked in?`);
    choices.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)}) ${c.name}   (${c.wsName})${c.space === linked ? "   ← current" : ""}`));
    const cur = choices.findIndex((c) => c.space === linked) + 1;
    for (;;) {
      const ans = (await ask(`  Type a number${cur ? ` (Enter = ${cur})` : ""}: `)) || (cur ? String(cur) : "");
      const n = Number(ans);
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) { pick = choices[n - 1]; break; }
      if (!ans) throw new CuError("No space chosen. Run `cu setup` again.");
      console.log(`  Please type a number from 1 to ${choices.length}.`);
    }
  }
  if (root) {
    git("-C", root, "config", "clickup.space", pick.space);
    git("-C", root, "config", "clickup.workspace", pick.workspace);
  }
  saveConfig({ ...config(), default_space: pick.space, default_workspace: pick.workspace });
  _ctx = undefined;
  const c = await ctx();
  console.log(`  ✔ space: ${c.name}`);
  const lid = await myList();
  console.log(`  ✔ your list: ${(await allLists()).find((l) => l.id === lid).name} (your new tasks go here)`);
  writeHooks();
  if (root) installRepo(root, c.name);

  // 3. make `cu` permanent when this ran through npx
  if (viaNpx() && !onPath("cu") && interactive()) {
    if (await confirm(`\nInstall the \`cu\` command permanently (npm i -g ${INSTALL_SPEC})?`)) {
      const r = spawnSync("npm", ["i", "-g", INSTALL_SPEC], { stdio: "inherit", shell: process.platform === "win32" });
      console.log(r.status === 0 ? "  ✔ `cu` installed" : `  ✖ install failed. Run it yourself: npm i -g ${INSTALL_SPEC}`);
    }
  }

  // 4. let AI tools drive it
  if (interactive()) await connectAgents(true);

  console.log(`
🎉 All set${root ? `: commits in ${path.basename(root)} are now logged in ClickUp` : ""}.

  cu today "Task A" "Task B"    plan your day
  cu start "Task A"             start working on it
  git commit ...                logged automatically
  cu finish "what I did"        done, moves to review
  cu team                       who is working on what
${root ? "" : "\n  Next: open a repo and run `cu setup` there to link it.\n"}
  Using Claude Code? Just tell it what you will work on today. It handles the rest.`);
}

async function cmdDoctor() {
  const ok = (m) => console.log(`  ✔ ${m}`);
  const bad = (m, fix) => { console.log(`  ✖ ${m}\n      fix: ${fix}`); problems++; };
  let problems = 0;
  console.log(`cu ${PKG.version} · node ${process.version}\n`);
  if (Number(process.versions.node.split(".")[0]) >= 18) ok("Node.js 18+");
  else bad(`Node.js ${process.version} is too old`, "install Node.js 18 or newer");
  if (onPath("git")) ok("git installed"); else bad("git not found", "install git");
  if (onPath("cu")) ok("`cu` command on PATH"); else bad("`cu` is not on PATH", `npm i -g ${INSTALL_SPEC}  (then check that \`npm prefix -g\`/bin is on PATH)`);
  let user = null;
  try {
    user = await me();
    ok(`ClickUp token works (${user.username})`);
  } catch (e) {
    if (e instanceof Offline) bad("ClickUp cannot be reached", "check your internet connection");
    else bad("no working ClickUp token", "cu setup");
  }
  const root = git("rev-parse", "--show-toplevel");
  if (!root) console.log("  · not inside a git repo: run `cu doctor` in a repo to check it too");
  else if (user) {
    try {
      const c = await ctx();
      ok(`${path.basename(root)} linked to space "${c.name}"`);
    } catch (e) {
      bad(`${path.basename(root)} is not linked to a ClickUp space`, "cu setup");
    }
    const hp = git("config", "--get", "core.hooksPath");
    if (hp === F.hooks && fs.existsSync(path.join(F.hooks, "post-commit"))) ok("git hooks on: commits are logged");
    else bad("git hooks are off for this repo", "cu setup");
    if (fs.existsSync(path.join(root, "CLAUDE.local.md"))) ok("Claude Code rules present (CLAUDE.local.md)");
    else bad("no CLAUDE.local.md for Claude Code", "cu setup");
  }
  if (root) {
    if (fs.existsSync(path.join(F.hooks, "prepare-commit-msg"))) ok(`commit messages get CU-<id> (commit_tag ${setting("commit_tag")})`);
    else bad("the commit-message hook is missing (older setup)", "cu setup");
  }
  ok(`token kept in: ${setting("token_store")}${setting("token_store") === "file" && keychain.tool() ? " (a keychain is available: cu config token_store keychain)" : ""}`);
  ok(`timer ${setting("timer")} · language ${setting("lang")} · update check ${setting("update_check")}`);
  const q = readJson(F.queue, []);
  if (q.length) bad(`${q.length} commit log(s) waiting to be sent`, "they go out with the next cu command when online");
  console.log(problems ? `\n${problems} problem(s) found.` : "\nEverything looks good.");
  return problems;
}

// ── settings and updates ────────────────────────────────────────────────────
async function cmdConfig(key, ...rest) {
  if (!key) {
    for (const [k, d] of Object.entries(SETTINGS)) {
      const v = k === "slack_webhook" ? (setting(k) ? "set" : "not set") : setting(k);
      console.log(`  ${k.padEnd(14)} ${String(v).padEnd(10)} ${d.help}`);
    }
    return console.log("\nChange one: cu config <name> <value>");
  }
  const d = SETTINGS[key];
  if (!d) throw new CuError(`Unknown setting "${key}". Settings: ${Object.keys(SETTINGS).join(", ")}`);
  const value = rest.join(" ").trim();
  if (!value) return console.log(setting(key));
  const conf = config();
  if (key === "slack_webhook") {
    if (value === "off") delete conf.slack_webhook;
    else if (!/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(value)) throw new CuError("That is not a Slack incoming webhook URL (https://hooks.slack.com/services/...).");
    else conf.slack_webhook = value;
    saveConfig(conf);
    return console.log(`slack_webhook ${value === "off" ? "removed" : "saved"}`);
  }
  if (!d.values.includes(value)) throw new CuError(`${key} can be: ${d.values.join(", ")}`);
  if (key === "token_store") {
    const tok = token();
    _me = undefined;
    await me();
    const saved = saveToken(tok, value);
    return console.log(saved === value ? `token now kept in the ${value}` : "keychain not available here; the token stays in the private file");
  }
  conf[key] = value;
  saveConfig(conf);
  console.log(`${key} = ${value}`);
}

/** Once a day, in a terminal only: is a newer clickup-flow published? Never slows a command by more than 1.5s. */
async function checkUpdate() {
  if (!interactive() || setting("update_check") === "off" || process.env.CI) return;
  let u = state().update || {};
  if (Date.now() - (u.checked || 0) > 86400000) {
    try {
      const r = await fetch(`https://registry.npmjs.org/${PKG.name}/latest`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) u.latest = (await r.json()).version;
    } catch {}
    u = { ...u, checked: Date.now() };
    const st = state();
    st.update = u;
    writeJson(F.state, st);
  }
  if (u.latest && newer(u.latest, PKG.version))
    console.error(`\n  ⬆ clickup-flow ${u.latest} is out (you have ${PKG.version}). Update: npm i -g ${PKG.name}`);
}

// ── AI agents ───────────────────────────────────────────────────────────────
/** How an MCP client should start the clickup-flow MCP server on this machine. */
function mcpLaunch() {
  const cuBin = onPath("cu");
  if (cuBin) {
    try {
      return { command: process.execPath, args: [fs.realpathSync(cuBin), "mcp"] };
    } catch {}
  }
  if (viaNpx()) return { command: "npx", args: ["-y", INSTALL_SPEC, "mcp"] };
  return { command: process.execPath, args: [fs.realpathSync(path.join(HERE, "..", "bin", "cu.js")), "mcp"] };
}

/** Add clickup-flow to an MCP client's JSON config ({"mcpServers": {...}}). Returns a message. */
function addToMcpConfig(file) {
  let conf = {};
  if (fs.existsSync(file)) {
    try {
      conf = JSON.parse(fs.readFileSync(file, "utf8") || "{}");
    } catch {
      return `could not read ${file} (not valid JSON), left it alone`;
    }
  }
  conf.mcpServers ??= {};
  conf.mcpServers["clickup-flow"] = mcpLaunch();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, `${JSON.stringify(conf, null, 2)}\n`);
  return null;
}

async function connectAgents(fromSetup = false) {
  const home = os.homedir();
  const cursorDir = path.join(home, ".cursor");
  const hasClaude = !!onPath("claude");
  const hasCursor = fs.existsSync(cursorDir);
  if (!hasClaude && !hasCursor && fromSetup) return;
  console.log(`\n${fromSetup ? "Step 3 · " : ""}Let your AI tools keep ClickUp in sync for you`);
  if (hasCursor) {
    const file = path.join(cursorDir, "mcp.json");
    const already = readJson(file, {}).mcpServers?.["clickup-flow"];
    if (already && fromSetup) console.log("  ✔ Cursor already has the clickup-flow tools");
    else if (!interactive() || (await confirm("  Give Cursor the clickup-flow tools (adds clickup-flow to ~/.cursor/mcp.json)?"))) {
      const err = addToMcpConfig(file);
      console.log(err ? `  ✖ Cursor: ${err}` : "  ✔ Cursor: clickup-flow tools added (restart Cursor once)");
    }
  }
  if (hasClaude) {
    console.log(`  Claude Code: run this once inside Claude Code (adds the skill, the tools and a session hook):
      /plugin install clickup-flow --marketplace twahanur/cu-clickup
    (older Claude Code: /plugin marketplace add twahanur/cu-clickup, then /plugin install clickup-flow@clickup-flow)`);
  }
  if (!fromSetup) {
    console.log(`\n  Any other MCP client (Claude Desktop, Windsurf, VS Code, ...): add this server to its MCP config:
${JSON.stringify({ mcpServers: { "clickup-flow": mcpLaunch() } }, null, 2).replace(/^/gm, "    ")}`);
  }
}

const cmdAgents = () => connectAgents(false);

async function cmdMcp() {
  const { startMcp } = await import("./mcp.js");
  await startMcp(); // runs until the client closes stdin
}

/** Run a command with its output captured, in another folder: used by the MCP server. Never prompts or exits. */
let _chain = Promise.resolve();
export function runCaptured(cmd, args, cwd) {
  const job = _chain.then(() => runCapturedNow(cmd, args, cwd));
  _chain = job.catch(() => {});
  return job;
}

async function runCapturedNow(cmd, args, cwd) {
  const out = [];
  const [log, err] = [console.log, console.error];
  console.log = (...a) => out.push(a.join(" "));
  console.error = (...a) => out.push(a.join(" "));
  const before = process.cwd();
  try {
    if (cwd) {
      if (!path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw new CuError(`repo_path must be an absolute folder path: ${cwd}`);
      process.chdir(cwd);
    }
    _ctx = undefined;
    try {
      await flushQueue();
    } catch {}
    await COMMANDS[cmd](...args);
    return { ok: true, text: out.join("\n").trim() || "done" };
  } catch (e) {
    if (e instanceof NeedsSetup)
      return { ok: false, text: `${e.message} clickup-flow is not set up here. Ask the user to run \`npx clickup-flow\` in a terminal in this project folder (it is interactive), then try again.` };
    if (e instanceof Usage) return { ok: false, text: "Missing or invalid arguments." };
    if (e instanceof CuError || e.code === "ENOENT") return { ok: false, text: [...out, `error: ${e.message}`].join("\n").trim() };
    return { ok: false, text: `unexpected error: ${e.message}` };
  } finally {
    [console.log, console.error] = [log, err];
    try {
      process.chdir(before);
    } catch {}
  }
}

/** Context for an agent's session start (Claude Code / Cursor hook). No network, never fails. */
function sessionContext() {
  const root = git("rev-parse", "--show-toplevel");
  if (!root) return null;
  let space = null;
  try {
    space = spaceIds()[0];
  } catch {}
  if (!space) return "clickup-flow (ClickUp) is installed, but this repo is not linked to ClickUp. If the user wants their work tracked in ClickUp, ask them to run `npx clickup-flow` in this folder; otherwise ignore ClickUp.";
  const name = git("config", "--get", "clickup.spacename") || "ClickUp";
  const cur = state().current?.[space];
  return `ClickUp tracking is on for this repo (clickup-flow, space "${name}"). Current task: ${cur ? `${cur.name} (${cur.id})` : "none"}.
${agentRules(name)}`;
}

// ── commands ────────────────────────────────────────────────────────────────
async function cmdWhere() {
  const c = await ctx();
  const root = git("rev-parse", "--show-toplevel");
  const src = root && git("config", "--get", "clickup.space") ? "this repo" : root ? "old project.json" : "last setup";
  console.log(`space: ${c.name} (${c.space}) · workspace ${c.workspace} · from ${src}`);
  const cur = current();
  console.log(cur ? `current task: ${line(cur)}` : "current task: —");
}

async function cmdToday(...args) {
  const [titles, o] = opts(args, "list", "due", "priority");
  if (!titles.length) throw new Usage();
  for (const title of titles) {
    const tk = await create(title, "todo", o.list, null, null, o);
    journal("plan", tk);
    console.log(`todo  ${line(tk)}`);
  }
}

async function cmdAdd(...args) {
  const [pos, o] = opts(args, "list", "parent", "desc", "due", "priority");
  if (!pos.length) throw new Usage();
  const t = await create(pos.join(" "), "todo", o.list, o.parent, o.desc, o);
  console.log(`todo  ${line(t)}\n  ${t.url}`);
}

async function cmdStart(...args) {
  const [pos, o] = opts(args, "list", "parent", "due", "priority");
  let ref = pos.join(" ");
  if (!ref) {
    if (!interactive()) throw new Usage();
    ref = await pickTask();
    if (!ref) return console.log("Nothing chosen.");
  }
  let t;
  try {
    t = await resolve(ref);
  } catch (e) {
    if (!(e instanceof NotFound)) throw e;
    t = await create(ref, "in progress", o.list, o.parent, null, o);
    console.log(`created  ${line(t)}`);
  }
  const prev = current();
  if (prev && prev.id !== t.id) console.log(`(was on ${line(prev)}; its status is unchanged)`);
  if (t.status.status !== (await status("in progress"))) await setStatus(t.id, "in progress");
  await comment(t.id, "🚧 Started");
  setCurrent(t);
  journal("start", t);
  console.log(`in progress  ${line(t)}\n  ${t.url}`);
  await timer("start", t.id);
}

/** Arrow-key list of my open tasks, plus "new task". Returns a task id, a new title, or null. */
async function pickTask() {
  const c = await ctx();
  const prefer = (await Promise.all(["in progress", "todo", "blocked", "in review"].map(status))).filter(Boolean);
  const rank = (s) => (prefer.includes(s) ? prefer.indexOf(s) : 9);
  const rows = (await myTasks()).filter((x) => x.status.status !== "backlog").sort((a, b) => rank(a.status.status) - rank(b.status.status));
  const NEW = "\u0000new";
  const choice = await pick(`Start which task? (${c.name})`, [
    ...rows.map((x) => ({ label: `${x.status.status.padEnd(12)} ${x.name}`, value: x.id })),
    { label: "＋ a new task…", value: NEW },
  ]);
  if (choice !== NEW) return choice;
  return (await ask("  New task title: ")) || null;
}

/** A small arrow-key picker with type-to-filter. Terminal only. */
function pick(title, items) {
  if (!interactive() || !items.length) return Promise.resolve(null);
  return new Promise((resolve) => {
    const out = process.stdout;
    let i = 0, filter = "", drawn = 0;
    const visible = () => items.filter((x) => x.label.toLowerCase().includes(filter.toLowerCase()));
    const width = () => Math.max(20, (out.columns || 100) - 2);
    const render = () => {
      const v = visible();
      if (i >= v.length) i = Math.max(0, v.length - 1);
      const top = Math.max(0, Math.min(i - 4, v.length - 10));
      const rows = [`${title}  ${filter ? `filter: ${filter}` : "type to filter · ↑↓ · Enter · Esc"}`,
        ...v.slice(top, top + 10).map((x, k) => `${top + k === i ? "❯" : " "} ${x.label}`)];
      if (!v.length) rows.push("  (no match)");
      if (drawn) out.write(`\x1b[${drawn}A\x1b[0J`);
      out.write(`${rows.map((r) => [...r].slice(0, width()).join("")).join("\n")}\n`);
      drawn = rows.length;
    };
    const finish = (val) => {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(val);
    };
    const onKey = (str, key = {}) => {
      const v = visible();
      if (key.name === "up") i = Math.max(0, i - 1);
      else if (key.name === "down") i = Math.min(v.length - 1, i + 1);
      else if (key.name === "return") return finish(v[i]?.value ?? null);
      else if (key.name === "escape" || (key.ctrl && key.name === "c")) return finish(null);
      else if (key.name === "backspace") { filter = filter.slice(0, -1); i = 0; }
      else if (str && !key.ctrl && !key.meta && [...str].length === 1 && str >= " ") { filter += str; i = 0; }
      render();
    };
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", onKey);
    render();
  });
}

async function cmdPause() {
  const cur = current();
  await timer("stop");
  console.log(`timer stopped${cur ? ` (${cur.name} stays current; cu start . to resume)` : ""}`);
}

async function cmdFinish(...summary) {
  const t = await resolve(".");
  if (summary.length) await comment(t.id, `🏁 ${summary.join(" ")}`);
  const st = await setStatus(t.id, "in review");
  setCurrent(null);
  journal("finish", t, summary.join(" "));
  await timer("stop");
  console.log(`${st || "finished"}  ${line(t)}`);
}

async function cmdBlock(...text) {
  const t = await resolve(".");
  const st = await setStatus(t.id, "blocked");
  await comment(t.id, `⛔ Blocked: ${text.join(" ") || "—"}`);
  journal("block", t, text.join(" "));
  await timer("stop");
  console.log(`${st || "blocked (comment only)"}  ${line(t)}`);
}

/** Give my task to a teammate: assign them, unassign me, leave a note. */
async function cmdHandoff(...args) {
  const [pos, o] = opts(args, "task");
  const [who, ...note] = pos;
  if (!who) throw new Usage();
  const tk = await resolve(o.task || ".");
  const ws = (await ctx()).workspace;
  const team = (await api("GET", "team")).teams.find((x) => String(x.id) === ws);
  const q = who.replace(/^@/, "").toLowerCase();
  const myId = (await me()).id;
  const people = (team?.members || []).map((m) => m.user).filter((u) => u && u.id !== myId);
  const hits = people.filter((u) => (u.username || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().split("@")[0] === q);
  if (hits.length !== 1)
    throw new CuError(hits.length ? `"${who}" matches several people: ${hits.map((u) => u.username).join(", ")}`
      : `Nobody called "${who}" in this workspace. People: ${people.map((u) => u.username).join(", ")}`);
  const to = hits[0];
  await api("PUT", `task/${checkId(tk.id, "task")}`, { assignees: { add: [to.id], rem: [(await me()).id] } });
  await comment(tk.id, `🤝 Handed over to ${to.username}${note.length ? `: ${note.join(" ")}` : ""}`);
  if (current()?.id === tk.id) {
    setCurrent(null);
    await timer("stop");
  }
  journal("handoff", tk, to.username);
  console.log(`handed over  ${line(tk)}  →  ${to.username}`);
}

async function cmdReport(...args) {
  const [, o] = opts(args, "date");
  const flags = args.filter((a) => a === "--slack" || a === "--clickup");
  const day = o.date || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new CuError("--date must look like 2026-11-05");
  let who = "me";
  try {
    who = (await me()).username;
  } catch (e) {
    if (!(e instanceof Offline) && !(e instanceof NeedsSetup)) throw e;
  }
  const text = buildReport(state().journal?.[day], who, day, I18N[setting("lang")] || I18N.en);
  console.log(text);
  if (flags.includes("--slack")) {
    const hook = setting("slack_webhook");
    if (!hook) throw new CuError("No Slack webhook yet: cu config slack_webhook https://hooks.slack.com/services/...");
    const r = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.replace(/\*\*/g, "*").replace(/^## /m, "*").replace(/^(\*[^\n]+)$/m, "$1*") }), signal: AbortSignal.timeout(10000) })
      .catch(() => { throw new Offline("Slack unreachable"); });
    console.log(r.ok ? "\n✔ posted to Slack" : `\n✖ Slack said ${r.status}`);
  }
  if (flags.includes("--clickup")) {
    const d = await dailyTask();
    await comment(d.id, text);
    console.log(`\n✔ posted on ${d.name}`);
  }
}

const WORKFLOW = `# clickup-flow: when a pull request is merged, move the ClickUp tasks it names (CU-<id> in its title, body,
# branch or commits) to a status, and link the PR. Needs a repository secret CLICKUP_API_TOKEN.
# Optional repository variable CLICKUP_DONE_STATUS (default "done"), for example "qa".
name: ClickUp - merged PR
on:
  pull_request:
    types: [closed]
permissions:
  contents: read
  pull-requests: read
jobs:
  clickup:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - name: Update ClickUp tasks
        env:
          CLICKUP_API_TOKEN: \${{ secrets.CLICKUP_API_TOKEN }}
          DONE_STATUS: \${{ vars.CLICKUP_DONE_STATUS || 'done' }}
          GH_TOKEN: \${{ github.token }}
          REPO: \${{ github.repository }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
          PR_URL: \${{ github.event.pull_request.html_url }}
          PR_TITLE: \${{ github.event.pull_request.title }}
          PR_BODY: \${{ github.event.pull_request.body }}
          PR_BRANCH: \${{ github.event.pull_request.head.ref }}
        run: |
          node --input-type=module <<'EOF'
          const env = process.env;
          if (!env.CLICKUP_API_TOKEN) { console.log("::notice::CLICKUP_API_TOKEN secret not set, skipping"); process.exit(0); }
          const gh = await fetch(\`https://api.github.com/repos/\${env.REPO}/pulls/\${env.PR_NUMBER}/commits?per_page=100\`,
            { headers: { Authorization: \`Bearer \${env.GH_TOKEN}\`, Accept: "application/vnd.github+json" } });
          const commits = gh.ok ? (await gh.json()).map((c) => c.commit.message).join("\\n") : "";
          const text = [env.PR_TITLE, env.PR_BODY, env.PR_BRANCH, commits].join("\\n");
          const ids = [...new Set([...text.matchAll(/\\bCU-([0-9a-z]{7,12})\\b/gi)].map((m) => m[1]))];
          if (!ids.length) { console.log("No CU-<id> found in this pull request."); process.exit(0); }
          const cu = (method, path, body) => fetch(\`https://api.clickup.com/api/v2/\${path}\`, { method,
            headers: { Authorization: env.CLICKUP_API_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(body) });
          for (const id of ids) {
            const s = await cu("PUT", \`task/\${id}\`, { status: env.DONE_STATUS });
            await cu("POST", \`task/\${id}/comment\`, { comment_text: \`✅ Merged: \${env.PR_URL}\`, notify_all: false });
            console.log(\`\${id}: \${s.ok ? "moved to " + env.DONE_STATUS : "status not changed (" + s.status + ")"}\`);
          }
          EOF
`;

async function cmdGithubAction(...args) {
  const root = git("rev-parse", "--show-toplevel");
  if (!root) throw new CuError("Run this inside the git repository.");
  const file = path.join(root, ".github", "workflows", "clickup-flow-merged.yml");
  if (fs.existsSync(file) && !args.includes("--force") && !(interactive() && (await confirm(`${path.relative(root, file)} exists. Replace it?`, false))))
    return console.log("left as it is");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, WORKFLOW);
  console.log(`✔ wrote ${path.relative(root, file)}

This one is for the whole team, so it is a normal file: commit and push it. Then, once:
  1. Add a repository secret CLICKUP_API_TOKEN (a ClickUp token that may edit the tasks):
       gh secret set CLICKUP_API_TOKEN
  2. Optional: the status for merged work, if not "done":
       gh variable set CLICKUP_DONE_STATUS --body "qa"
After that, merging a pull request that mentions CU-<id> (commits made with cu already do) moves those tasks.`);
}

export const COMMAND_NAMES = () => Object.keys(COMMANDS).filter((c) => !["hook", "init"].includes(c));
const FLAGS = "--list --parent --desc --due --priority --task --all --space --token --date --slack --clickup --force";

function cmdCompletion(shell = "bash") {
  const cmds = COMMAND_NAMES().join(" ");
  if (shell === "fish")
    return console.log(`complete -c cu -f -n "__fish_use_subcommand" -a "${cmds}"\n${FLAGS.split(" ").map((f) => `complete -c cu -l ${f.slice(2)}`).join("\n")}`);
  if (!["bash", "zsh"].includes(shell)) throw new CuError("cu completion bash | zsh | fish");
  console.log(`${shell === "zsh" ? "autoload -U +X bashcompinit && bashcompinit\n" : ""}_cu() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  if [ "$COMP_CWORD" -eq 1 ]; then COMPREPLY=( $(compgen -W "${cmds}" -- "$cur") )
  elif [ "\${COMP_WORDS[1]}" = "config" ] && [ "$COMP_CWORD" -eq 2 ]; then COMPREPLY=( $(compgen -W "${Object.keys(SETTINGS).join(" ")}" -- "$cur") )
  elif [ "\${COMP_WORDS[1]}" = "completion" ]; then COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
  else case "$cur" in --*) COMPREPLY=( $(compgen -W "${FLAGS}" -- "$cur") );; esac; fi
}
complete -F _cu cu`);
}

async function cmdCurrent() {
  const cur = current();
  if (!cur) return console.log(`No current task in "${(await ctx()).name}".`);
  try {
    await getTask(cur.id);
  } catch (e) {
    if (e instanceof Offline) throw e;
    setCurrent(null);
    return console.log(`Your current task (${line(cur)}) no longer exists in ClickUp, so it was cleared.`);
  }
  return cmdShow(cur.id);
}

async function cmdShow(ref) {
  if (!ref) throw new Usage();
  let t = await resolve(ref);
  if (!t.list || !t.assignees) t = await getTask(t.id);
  const who = t.assignees.map((a) => a.username).join(", ") || "—";
  console.log(`${line(t)}\n  status: ${t.status.status}  ·  assignee: ${who}\n  list: ${t.list.name}\n  ${t.url}`);
}

async function cmdMine(...flags) {
  const c = await ctx();
  const names = c.statuses.map((s) => s.name);
  const first = (await Promise.all(["in progress", "blocked", "in review"].map(status))).filter(Boolean);
  const rank = (s) => (first.includes(s) ? first.indexOf(s) : 9) * 100 + (names.includes(s) ? names.indexOf(s) : 99);
  const rows = (await myTasks()).filter((t) => flags.includes("--all") || t.status.status !== "backlog");
  const cur = current()?.id;
  for (const t of rows.sort((a, b) => rank(a.status.status) - rank(b.status.status)))
    console.log(`${t.id === cur ? "▶" : " "} ${t.status.status.padEnd(12)} ${line(t)}`);
  console.log(`\n${rows.length} task(s) in ${c.name}`);
}

async function cmdLists() {
  for (const l of await allLists()) console.log(`${l.id}  ${l.folder ? `${l.folder} → ` : ""}${l.name}`);
}

async function cmdStatuses() {
  for (const s of (await ctx()).statuses) console.log(`${s.name.padEnd(16)} (${s.type})`);
}

async function cmdStatus(ref, ...words) {
  if (!ref || !words.length) throw new Usage();
  const t = await resolve(ref);
  const st = await setStatus(t.id, words.join(" "), true);
  if ([await status("in review"), await status("done")].includes(st) && current()?.id === t.id) setCurrent(null);
  console.log(`${st}  ${line(t)}`);
}

async function cmdComment(...args) {
  if (!args.length) throw new Usage();
  const [ref, text] = args.length === 1 ? [".", args[0]] : [args[0], args.slice(1).join(" ")];
  const t = await resolve(ref);
  await comment(t.id, text);
  console.log(`commented on ${line(t)}`);
}

async function cmdPr(...args) {
  if (args.length < 1 || args.length > 2) throw new Usage();
  const [ref, url] = args.length === 1 ? [".", args[0]] : args;
  const t = await resolve(ref);
  const field = ((await getTask(t.id)).custom_fields || [])
    .find((f) => ["pr link", "pr", "pull request", "pr url"].includes(f.name.toLowerCase()));
  if (field) await api("POST", `task/${t.id}/field/${field.id}`, { value: url });
  await setStatus(t.id, "in review");
  await comment(t.id, `🔀 PR opened: ${url}`);
  console.log(`in review  ${line(t)}  (${url})`);
}

async function cmdBug(title, ...desc) {
  if (!title) throw new Usage();
  const bugList = (await allLists()).find((l) => l.name.toLowerCase().includes("bug"))?.id ?? (await myList());
  const body = { name: title, markdown_content: desc.join(" ") || title, assignees: [(await me()).id] };
  const todo = await status("todo");
  if (todo) body.status = todo;
  for (const f of (await api("GET", `list/${bugList}/field`)).fields || []) {
    if (f.name.toLowerCase() === "type" && f.type === "drop_down") {
      const opt = (f.type_config?.options || []).find((x) => x.name.toLowerCase().includes("bug"));
      if (opt) body.custom_fields = [{ id: f.id, value: opt.id }];
    }
  }
  console.log(`bug created: ${(await api("POST", `list/${bugList}/task`, body)).url}`);
}

async function cmdTasks(file) {
  const c = await ctx();
  const name = (await me()).username;
  file ||= path.join(CONF_DIR, `tasks-${name.split(" ")[0]}-${c.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}.md`);
  const rows = await myTasks(true);
  const doneName = await status("done");
  const isDone = (x) => x.status.status === doneName || ["done", "closed"].includes(x.status.type);
  const done = rows.filter(isDone);
  const out = [`# ${t("tasksOf")} ${name} · ${c.name}`, "",
    `${t("made")}, ${new Date().toLocaleString("sv").slice(0, 16)}. ${t("regen")}: \`cu tasks\``, "",
    `${t("total")} **${rows.length}** · ${t("doneW")} **${done.length}** · ${t("left")} **${rows.length - done.length}**`, ""];
  for (const lname of [...new Set(rows.map((x) => x.list.name))].sort()) {
    const lt = rows.filter((x) => x.list.name === lname);
    out.push(`## ${lname} (${lt.filter(isDone).length}/${lt.length} ${t("doneW")})`, "",
      ...lt.map((x) => `- [${isDone(x) ? "x" : " "}] [${x.name}](${x.url}) — \`${x.status.status}\``), "");
  }
  fs.writeFileSync(file, out.join("\n"));
  console.log(`${file}: ${rows.length} task(s), ${done.length} done`);
}

async function cmdTeam() {
  const c = await ctx();
  const wanted = [...new Set(await Promise.all(["in progress", "blocked", "in review"].map(status)))].filter(Boolean);
  const rows = await paged(`team/${c.workspace}/task?space_ids[]=${c.space}&subtasks=true&order_by=updated`
    + wanted.map((s) => `&statuses[]=${encodeURIComponent(s)}`).join(""));
  const people = new Map();
  for (const t of rows)
    for (const who of t.assignees.length ? t.assignees.map((a) => a.username) : ["— unassigned"])
      people.set(who, [...(people.get(who) || []), t]);
  if (!people.size) return console.log(`Nobody has a task ${wanted.join(" / ")} in ${c.name}.`);
  for (const who of [...people.keys()].sort()) {
    console.log(`\n${who}`);
    const ts = people.get(who).sort((a, b) =>
      (wanted.indexOf(a.status.status) - wanted.indexOf(b.status.status)) || (Number(b.date_updated) - Number(a.date_updated)));
    for (const t of ts) console.log(`  ${t.status.status.padEnd(12)} ${t.name.slice(0, 70)}  · ${ago(t.date_updated)}`);
  }
  console.log(`\n${rows.length} task(s) in ${c.name}`);
}

/** Add "CU-<id>" as the last line of a commit message, before git's comment lines. Pure, for tests. */
export function tagMessage(text, id) {
  if (/\bCU-[0-9a-z]{7,12}\b/i.test(text)) return text;
  const lines = text.split("\n");
  let cut = lines.findIndex((l) => l.startsWith("#"));
  if (cut < 0) cut = lines.length;
  const body = lines.slice(0, cut).join("\n").replace(/\s+$/, "");
  const rest = lines.slice(cut).join("\n");
  return `${body}\n\nCU-${id}\n${rest ? `\n${rest}` : ""}`;
}

async function cmdHook(event, ...args) {
  inHook = true;
  try {
    if (event === "prepare-commit-msg") {
      // args: message file, source (message, template, merge, squash, commit=amend). Local only, no network.
      const [file, source] = args;
      if (!file || ["merge", "squash", "commit"].includes(source) || setting("commit_tag") === "off") return;
      const cur = current();
      if (!cur) return;
      fs.writeFileSync(file, tagMessage(fs.readFileSync(file, "utf8"), cur.id));
      return;
    }
    const branch = git("rev-parse", "--abbrev-ref", "HEAD");
    const repo = path.basename(git("rev-parse", "--show-toplevel"));
    if (event === "session-start") {
      const text = sessionContext();
      if (!text) return;
      const out = process.env.CURSOR_PLUGIN_ROOT
        ? { additional_context: text }
        : { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } };
      process.stdout.write(`${JSON.stringify(out)}\n`);
      return;
    }
    if (event === "post-checkout") {
      // args: prev_head new_head is_branch_checkout. Only `git checkout -b feat/CU-<id>-...` (a branch made just
      // now from where you stand) starts that task; checking out a colleague's branch changes nothing.
      const [prev, next, isBranch] = args;
      const tid = isBranch === "1" && prev === next ? refFromText(branch) : null;
      const isNew = git("reflog", "show", "--format=%H", branch).split("\n").filter(Boolean).length <= 1;
      if (tid && isNew && current()?.id !== tid) await cmdStart(tid);
    } else if (event === "post-commit") {
      // An amended or rebased commit was logged already as the original.
      const action = git("reflog", "-1", "--format=%gs");
      if (/^commit \(amend\)/.test(action) || /^(rebase|cherry-pick)/.test(action) || process.env.GIT_REFLOG_ACTION?.startsWith("rebase")) return;
      const msg = git("log", "-1", "--format=%s");
      const fullMsg = git("log", "-1", "--format=%B");
      const sha = git("log", "-1", "--format=%h");
      const stat = git("diff", "--shortstat", "HEAD~1", "HEAD") || git("show", "--shortstat", "--format=", "HEAD");
      const text = `✅ \`${repo}\` commit \`${sha}\` on \`${branch}\`: ${msg}${stat ? `\n${stat.trim()}` : ""}`;
      const space = spaceIds()[0];
      const cur = current();
      let tid = refFromText(fullMsg) || refFromText(branch) || cur?.id || null;
      journal("commit", cur && cur.id === tid ? cur : null, `${repo}: ${msg}`);
      try {
        try {
          await flushQueue();
        } catch (e) {
          if (e instanceof Offline) throw e;
        }
        let logged = false;
        if (tid) {
          try {
            await comment(tid, text);
            logged = true;
            console.log(`[clickup] commit logged on ${cur && cur.id === tid ? line(cur) : tid}`);
          } catch (e) {
            if (e instanceof Offline) throw e;
            console.error(`[clickup] task ${tid} not reachable (${e.message.slice(0, 80)}), using today's task`);
            if (cur && cur.id === tid) setCurrent(null);
            tid = null; // if we go offline now, queue it for today's task instead
          }
        }
        if (!logged) {
          const d = await dailyTask();
          await comment(d.id, text);
          console.log(`[clickup] no current task: logged on ${d.name}  (tip: cu start "<task>")`);
        }
      } catch (e) {
        if (!(e instanceof Offline)) throw e;
        enqueue(space, tid, text);
        console.error("[clickup] offline: commit log saved, it will be sent automatically later");
      }
    }
  } catch (e) { // never break git
    console.error(`[clickup] skipped: ${e.message}`);
  }
}

const COMMANDS = {
  setup: cmdSetup, init: cmdSetup, doctor: cmdDoctor, where: cmdWhere, team: cmdTeam, today: cmdToday, add: cmdAdd, start: cmdStart,
  finish: cmdFinish, block: cmdBlock, current: cmdCurrent, show: cmdShow, mine: cmdMine, lists: cmdLists,
  statuses: cmdStatuses, status: cmdStatus, comment: cmdComment, pr: cmdPr, bug: cmdBug, tasks: cmdTasks,
  hook: cmdHook, agents: cmdAgents, mcp: cmdMcp, config: cmdConfig, pause: cmdPause, handoff: cmdHandoff,
  report: cmdReport, "github-action": cmdGithubAction, completion: cmdCompletion, version: () => console.log(PKG.version),
};

export async function main(argv) {
  const [cmd, ...rest] = argv;
  if (["-v", "--version"].includes(cmd)) return COMMANDS.version(), 0;
  if (!cmd && interactive() && needsSetup()) return run("setup", []);
  if (!cmd || !COMMANDS[cmd]) return console.log(USAGE), cmd && !["-h", "--help", "help"].includes(cmd) ? 1 : 0;
  return run(cmd, rest);
}

/** True when there is no token, or this repo is not linked yet. */
function needsSetup() {
  if (!hasToken()) return true;
  try {
    spaceIds();
    return false;
  } catch {
    return true;
  }
}

async function run(cmd, rest) {
  try {
    if (!["setup", "init", "hook", "version", "doctor", "mcp", "agents", "config", "completion"].includes(cmd)) {
      try {
        await flushQueue();
      } catch {} // still offline or not linked: the command itself will say so
    }
    const r = await COMMANDS[cmd](...rest);
    if (!["hook", "mcp", "version", "completion"].includes(cmd)) await checkUpdate().catch(() => {});
    return cmd === "doctor" && r ? 1 : 0;
  } catch (e) {
    if (e instanceof NeedsSetup && !["setup", "init", "hook"].includes(cmd) && interactive()) {
      console.log(e.message);
      if (await confirm("Set it up now? (takes a minute)")) {
        try {
          await cmdSetup();
        } catch (e2) {
          if (e2 instanceof CuError) return console.error(`error: ${e2.message}`), 1;
          throw e2;
        }
        console.log("");
        return needsSetup() ? 1 : run(cmd, rest);
      }
      return 1;
    }
    if (e instanceof Usage) return console.log(USAGE), 1;
    if (e instanceof NeedsSetup) return console.error(`error: ${e.message} Run: cu setup`), 1;
    if (e instanceof CuError) return console.error(`error: ${e.message}`), 1;
    throw e;
  }
}
