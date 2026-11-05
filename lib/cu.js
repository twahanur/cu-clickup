// cu: ClickUp from the terminal and from git, for any project. No dependencies (Node >= 18).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8"));
export const CONF_DIR = process.env.CU_CONFIG_DIR || path.join(os.homedir(), ".config", "clickup");
const API = process.env.CU_API_BASE || "https://api.clickup.com/api/v2";
const F = {
  token: path.join(CONF_DIR, "token"),
  config: path.join(CONF_DIR, "config.json"),
  state: path.join(CONF_DIR, "state.json"),
  queue: path.join(CONF_DIR, "queue.json"),
  legacy: path.join(CONF_DIR, "project.json"),
  hooks: path.join(CONF_DIR, "hooks"),
};

export const USAGE = `cu ${PKG.version}: ClickUp from the terminal and from git, for any project.

Setup (once, then once inside every repo):
  cu setup                    asks for your ClickUp token (first time) and which space this repo belongs to,
                              makes your own list "👤 <your name>" there, turns on the git hooks and writes
                              CLAUDE.local.md (git-ignored) so Claude Code keeps ClickUp up to date

A task <ref> is a ClickUp id (86ex1abcd or CU-86ex1abcd), "." for the current task, or part of its name.

Daily flow:
  cu today "<title>" ["<title>" ...] [--list L]   plan the day: each title becomes a task in todo
  cu start <ref | "new title"> [--list L] [--parent REF]
                                         in progress + current (creates the task when nothing matches)
  cu comment [<ref>] <text>              note progress (default: current task)
  cu finish [summary]                    comment the summary, move to in review, clear current
  cu block <text>                        current task -> blocked, with what you wait for

Look around:
  cu team                                who is working on what in this space right now
  cu mine [--all] | current | show <ref> | where | lists | statuses

Other:
  cu setup [--space S] [--token pk_..]   switch this repo's space or change the token
  cu add <title> [--list L] [--parent REF] [--desc D]
  cu status <ref> <status>               todo / in progress / in review / done ... matched to the space's names
  cu pr [<ref>] <url>                    set the PR link field (if any) and move to in review
  cu bug <title> [description]           a bug in the space's bug list (or your own list)
  cu tasks [file]                        all my tasks in this space as a Markdown checklist
  cu version

Git hooks: each commit is logged on the task named in its message (CU-<id>), else on the current task, else on
today's catch-all task "🗒 <name>: অন্যান্য কাজ <date>". Offline, logs are queued in ${CONF_DIR}/queue.json and
sent by the next commit or cu command.`;

export class CuError extends Error {}
export class Offline extends CuError {}
class Usage extends Error {}

// ── plumbing ────────────────────────────────────────────────────────────────
function token() {
  let tok = process.env.CLICKUP_API_TOKEN;
  if (!tok && fs.existsSync(F.token)) tok = fs.readFileSync(F.token, "utf8").trim();
  if (!tok) throw new CuError("No ClickUp token. Run: cu setup");
  return tok;
}

export async function api(method, p, body) {
  let res;
  try {
    res = await fetch(`${API}/${p}`, {
      method,
      headers: { Authorization: token(), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new Offline(`ClickUp unreachable: ${e.cause?.code || e.name || e.message}`);
  }
  const txt = await res.text();
  if (!res.ok) throw new CuError(`ClickUp ${method} ${p}: ${res.status} ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : {};
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

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

const config = () => readJson(F.config, {});
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
  if (!space) throw new CuError("This repo is not linked to a ClickUp space yet. Run: cu setup");
  return [String(space), String(ws)];
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
  await api("PUT", `task/${tid}`, { status: name });
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

async function dailyTask() {
  const sp = spaceIds()[0];
  const d = state().daily?.[sp];
  if (d && d.date === today()) return d;
  const name = `🗒 ${(await me()).username.split(" ")[0]}: অন্যান্য কাজ ${today()}`;
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
    if (r.last_page !== false || !r.tasks.length) return rows;
  }
}

async function myTasks(includeClosed = false) {
  const c = await ctx();
  return paged(`team/${c.workspace}/task?space_ids[]=${c.space}&assignees[]=${(await me()).id}&order_by=updated&subtasks=true`
    + (includeClosed ? "&include_closed=true" : ""));
}

const getTask = (tid) => api("GET", `task/${tid}`);

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
  if (!hits.length) throw new CuError(`No open task of mine in "${(await ctx()).name}" matches "${ref}"`);
  throw new CuError(`"${ref}" matches several tasks:\n${hits.slice(0, 10).map((t) => `  ${line(t)}`).join("\n")}`);
}

/** A ClickUp id written as CU-<id> in a branch name or commit message, or null. */
export function refFromText(text) {
  return /\bCU-([0-9a-z]{7,12})\b/i.exec(text)?.[1] ?? null;
}

const comment = (tid, text) => api("POST", `task/${tid}/comment`, { comment_text: text, notify_all: false });

async function create(title, st = "todo", listRef = null, parent = null, desc = null) {
  const body = { name: title, assignees: [(await me()).id] };
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

// ── setup ───────────────────────────────────────────────────────────────────
const CLAUDE_START = "<!-- clickup:start -->", CLAUDE_END = "<!-- clickup:end -->";
const claudeRules = (space) => `## ClickUp: keep it in sync without being asked

Work on this repo is tracked in ClickUp (space "${space}") with the CLI \`cu\`. Its config and token live in
\`~/.config/clickup/\`: never copy them or this section into tracked files, and never print the token. Run \`cu\` for
usage. A task is referenced by its ClickUp id (\`86ex1abcd\`, or \`CU-86ex1abcd\` in a commit), by part of its name,
or \`.\` for the current task of this space.

Do the following on your own, as part of the work, every time:

1. **The user lists the day's work** ("আজ এই এই কাজ করব") -> first \`cu mine\` so nothing is duplicated, then
   \`cu today "<title>" "<title>" ...\`: each becomes a task in \`todo\` in the developer's own list "👤 <name>".
   A subtask: \`cu add "<title>" --parent <ref>\`.
2. **Before starting a piece of work**, \`cu start <ref | "new title">\`: \`in progress\` and current; creates the task
   when nothing matches. Switching to other work -> \`cu start\` that one.
3. **Commits** are logged by the git hook on the current task (or on \`CU-<id>\` in the message). With no current
   task they go to today's catch-all task, so always \`cu start\` the real task first. Offline logs are queued and
   sent later automatically.
4. **Progress worth telling the team** (a decision, a partial result, end of day):
   \`cu comment "<what was done, what is left, anything blocking>"\`.
5. **Finished** (tests pass) -> \`cu finish "<summary>"\` (comment + \`in review\`). A PR -> \`cu pr <url>\`.
   Blocked -> \`cu block "<what you wait for>"\`.
6. "কে কী করছে" / who is working on what -> \`cu team\`.
7. \`done\` only when the user confirms it is merged and tested. Never touch another developer's tasks.

If \`cu\` fails (no token, network, repo not linked), tell the user in one line (fix: \`cu setup\` in this repo)
and carry on with the code; do not retry in a loop.
`;

/** Hook scripts in ~/.config/clickup/hooks that call this cu, wherever npm put it. */
function writeHooks() {
  fs.mkdirSync(F.hooks, { recursive: true });
  const script = fs.realpathSync(path.join(HERE, "..", "bin", "cu.js"));
  for (const ev of ["post-commit", "post-checkout"]) {
    fs.writeFileSync(path.join(F.hooks, ev), `#!/bin/sh
# cu (ClickUp): log git activity on the current task. Never fails the git command.
if command -v cu >/dev/null 2>&1; then cu hook ${ev} "$@"
elif [ -x "${process.execPath}" ] && [ -f "${script}" ]; then "${process.execPath}" "${script}" hook ${ev} "$@"
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
      console.log("✔ removed the old Python `cu` from ~/.local/bin");
    }
  } catch {}
}

function installRepo(root, spaceName) {
  git("-C", root, "config", "core.hooksPath", F.hooks);
  const file = path.join(root, "CLAUDE.local.md");
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const block = `${CLAUDE_START}\n${claudeRules(spaceName)}${CLAUDE_END}\n`;
  const a = text.indexOf(CLAUDE_START), b = text.indexOf(CLAUDE_END);
  if (a >= 0 && b > a) text = text.slice(0, a) + block.trimEnd() + text.slice(b + CLAUDE_END.length);
  else text = (text.trim() ? `${text.trimEnd()}\n\n` : "") + block;
  fs.writeFileSync(file, text);
  let gitDir = git("-C", root, "rev-parse", "--git-common-dir") || ".git";
  if (!path.isAbsolute(gitDir)) gitDir = path.join(root, gitDir);
  const exclude = path.join(gitDir, "info", "exclude");
  const lines = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8").split(/\r?\n/) : [];
  if (!lines.includes("CLAUDE.local.md")) {
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    fs.appendFileSync(exclude, "\nCLAUDE.local.md\n");
  }
  console.log(`✔ ${path.basename(root)}: git hooks on, Claude rules in CLAUDE.local.md (not tracked by git)`);
}

async function cmdSetup(...args) {
  const [pos, o] = opts(args, "space", "token");
  let tok = o.token || pos.find((a) => a.startsWith("pk_"));
  const have = fs.existsSync(F.token);
  if (!tok && !have) {
    console.log("ClickUp token: ClickUp → avatar → Settings → Apps → API Token → Generate/Copy (starts with pk_)");
    tok = await ask("Paste token: ", true);
    if (!tok) throw new CuError("No token given.");
  }
  if (tok) process.env.CLICKUP_API_TOKEN = tok;
  _me = undefined;
  let user;
  try {
    user = await me();
  } catch (e) {
    if (e instanceof Offline) throw e;
    throw new CuError(`Token rejected by ClickUp (${e.message}). Run \`cu setup --token pk_...\` with a fresh one.`);
  }
  if (tok) {
    fs.mkdirSync(CONF_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(F.token, `${tok}\n`, { mode: 0o600 });
    fs.chmodSync(F.token, 0o600);
    console.log(`✔ token saved for ${user.username}`);
  } else console.log(`✔ signed in as ${user.username} (change token: cu setup --token pk_...)`);

  const root = git("rev-parse", "--show-toplevel");
  let linked = root ? git("config", "--get", "clickup.space") : config().default_space;
  linked ||= root ? LEGACY.space_id : null;
  const choices = [];
  for (const team of (await api("GET", "team")).teams)
    for (const sp of (await api("GET", `team/${team.id}/space?archived=false`)).spaces)
      choices.push({ workspace: String(team.id), wsName: team.name, space: String(sp.id), name: sp.name });
  if (!choices.length) throw new CuError("Your ClickUp account has no spaces you can see.");
  let pick;
  if (o.space) {
    const hits = choices.filter((c) => c.space === o.space || c.name.toLowerCase().includes(o.space.toLowerCase()));
    if (hits.length !== 1) throw new CuError(`--space "${o.space}" matches ${hits.length} spaces: ${hits.map((c) => c.name).join(", ")}`);
    pick = hits[0];
  } else if (choices.length === 1) pick = choices[0];
  else {
    console.log(`\nWhich ClickUp space${root ? ` for ${path.basename(root)}` : ""}?`);
    choices.forEach((c, i) => console.log(`  ${i + 1}) ${c.wsName} / ${c.name}${c.space === linked ? "   ← now" : ""}`));
    const cur = choices.findIndex((c) => c.space === linked) + 1;
    const ans = (await ask(`Number${cur ? ` (Enter = ${cur})` : ""}: `)) || (cur ? String(cur) : "");
    const n = Number(ans);
    if (!Number.isInteger(n) || n < 1 || n > choices.length) throw new CuError("No space chosen. Run `cu setup` again (or `cu setup --space <name>`).");
    pick = choices[n - 1];
  }
  if (root) {
    git("-C", root, "config", "clickup.space", pick.space);
    git("-C", root, "config", "clickup.workspace", pick.workspace);
  }
  saveConfig({ ...config(), default_space: pick.space, default_workspace: pick.workspace });
  _ctx = undefined;
  const c = await ctx();
  console.log(`✔ space: ${pick.wsName} / ${c.name}${root ? `  (linked to ${path.basename(root)})` : ""}`);
  const lid = await myList();
  console.log(`✔ your list: ${(await allLists()).find((l) => l.id === lid).name}: new tasks go here`);
  writeHooks();
  if (root) installRepo(root, c.name);
  else console.log("ℹ not inside a git repo: run `cu setup` inside each repo to link it and turn on its hooks");
  console.log('\nDone. Start with:  cu today "<task>" ...   then   cu start "<task>"');
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
  const [titles, o] = opts(args, "list");
  if (!titles.length) throw new Usage();
  for (const title of titles) console.log(`todo  ${line(await create(title, "todo", o.list))}`);
}

async function cmdAdd(...args) {
  const [pos, o] = opts(args, "list", "parent", "desc");
  if (!pos.length) throw new Usage();
  const t = await create(pos.join(" "), "todo", o.list, o.parent, o.desc);
  console.log(`todo  ${line(t)}\n  ${t.url}`);
}

async function cmdStart(...args) {
  const [pos, o] = opts(args, "list", "parent");
  if (!pos.length) throw new Usage();
  const ref = pos.join(" ");
  let t;
  try {
    t = await resolve(ref);
  } catch (e) {
    if (e instanceof Offline || e.message.includes("several")) throw e;
    t = await create(ref, "in progress", o.list, o.parent);
    console.log(`created  ${line(t)}`);
  }
  const prev = current();
  if (prev && prev.id !== t.id) console.log(`(was on ${line(prev)}; its status is unchanged)`);
  if (t.status.status !== (await status("in progress"))) await setStatus(t.id, "in progress");
  await comment(t.id, "🚧 Started");
  setCurrent(t);
  console.log(`in progress  ${line(t)}\n  ${t.url}`);
}

async function cmdFinish(...summary) {
  const t = await resolve(".");
  if (summary.length) await comment(t.id, `🏁 ${summary.join(" ")}`);
  const st = await setStatus(t.id, "in review");
  setCurrent(null);
  console.log(`${st || "finished"}  ${line(t)}`);
}

async function cmdBlock(...text) {
  const t = await resolve(".");
  const st = await setStatus(t.id, "blocked");
  await comment(t.id, `⛔ Blocked: ${text.join(" ") || "—"}`);
  console.log(`${st || "blocked (comment only)"}  ${line(t)}`);
}

async function cmdCurrent() {
  const cur = current();
  if (!cur) return console.log(`No current task in "${(await ctx()).name}".`);
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
  const isDone = (t) => t.status.status === doneName || ["done", "closed"].includes(t.status.type);
  const done = rows.filter(isDone);
  const out = [`# ${name}-এর কাজের তালিকা · ${c.name}`, "",
    `ClickUp থেকে তৈরি, ${new Date().toLocaleString("sv").slice(0, 16)}। আবার তৈরি করতে: \`cu tasks\``, "",
    `মোট **${rows.length}**টা · শেষ **${done.length}** · বাকি **${rows.length - done.length}**`, ""];
  for (const lname of [...new Set(rows.map((t) => t.list.name))].sort()) {
    const lt = rows.filter((t) => t.list.name === lname);
    out.push(`## ${lname} (${lt.filter(isDone).length}/${lt.length} শেষ)`, "",
      ...lt.map((t) => `- [${isDone(t) ? "x" : " "}] [${t.name}](${t.url}) — \`${t.status.status}\``), "");
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

async function cmdHook(event, ...args) {
  try {
    const branch = git("rev-parse", "--abbrev-ref", "HEAD");
    const repo = path.basename(git("rev-parse", "--show-toplevel"));
    if (event === "post-checkout") {
      // args: prev_head new_head is_branch_checkout. A branch named after CU-<id> starts that task.
      const tid = args[2] === "1" ? refFromText(branch) : null;
      if (tid && current()?.id !== tid) await cmdStart(tid);
    } else if (event === "post-commit") {
      const msg = git("log", "-1", "--format=%s");
      const sha = git("log", "-1", "--format=%h");
      const stat = git("diff", "--shortstat", "HEAD~1", "HEAD") || git("show", "--shortstat", "--format=", "HEAD");
      const text = `✅ \`${repo}\` commit \`${sha}\` on \`${branch}\`: ${msg}${stat ? `\n${stat.trim()}` : ""}`;
      const space = spaceIds()[0];
      const cur = current();
      const tid = refFromText(msg) || refFromText(branch) || cur?.id || null;
      try {
        await flushQueue();
        if (tid) {
          await comment(tid, text);
          console.log(`[clickup] commit logged on ${cur && cur.id === tid ? line(cur) : tid}`);
        } else {
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
  setup: cmdSetup, where: cmdWhere, team: cmdTeam, today: cmdToday, add: cmdAdd, start: cmdStart,
  finish: cmdFinish, block: cmdBlock, current: cmdCurrent, show: cmdShow, mine: cmdMine, lists: cmdLists,
  statuses: cmdStatuses, status: cmdStatus, comment: cmdComment, pr: cmdPr, bug: cmdBug, tasks: cmdTasks,
  hook: cmdHook, version: () => console.log(PKG.version),
};

export async function main(argv) {
  const [cmd, ...rest] = argv;
  if (["-v", "--version"].includes(cmd)) return COMMANDS.version(), 0;
  if (!cmd || !COMMANDS[cmd]) return console.log(USAGE), cmd && !["-h", "--help", "help"].includes(cmd) ? 1 : 0;
  try {
    if (!["setup", "hook", "version"].includes(cmd)) {
      try {
        await flushQueue();
      } catch {} // still offline or not linked: the command itself will say so
    }
    await COMMANDS[cmd](...rest);
    return 0;
  } catch (e) {
    if (e instanceof Usage) return console.log(USAGE), 1;
    if (e instanceof CuError) return console.error(`error: ${e.message}`), 1;
    throw e;
  }
}
