import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "cu.js");

// Keep the in-process import away from the real ~/.config/clickup.
const IMPORT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cu-features-"));
process.env.CU_CONFIG_DIR = IMPORT_DIR;
const cu = await import("../lib/cu.js");
const { parseDue, parsePriority, newer, tagMessage, buildReport, looksLikeToken, SETTINGS, CuError } = cu;

const tmpDirs = [IMPORT_DIR];
const freshDir = (prefix = "cu-features-") => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
};
process.on("exit", () => {
  for (const d of tmpDirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
});

// ── parseDue ────────────────────────────────────────────────────────────────
// Thursday 2026-11-05, 09:30 local.
const NOW = new Date(2026, 10, 5, 9, 30);
const noon = (y, m, d) => new Date(y, m - 1, d, 12).getTime();

test("parseDue: today and tomorrow are local noon", () => {
  assert.equal(parseDue("today", NOW), noon(2026, 11, 5));
  assert.equal(parseDue("tomorrow", NOW), noon(2026, 11, 6));
  assert.equal(parseDue("  TODAY ", NOW), noon(2026, 11, 5));
});

test("parseDue: weekday names give the next occurrence, never today", () => {
  assert.equal(parseDue("fri", NOW), noon(2026, 11, 6));
  assert.equal(parseDue("friday", NOW), noon(2026, 11, 6));
  assert.equal(parseDue("Fri", NOW), noon(2026, 11, 6));
  assert.equal(parseDue("thu", NOW), noon(2026, 11, 12)); // today is Thursday -> next week
  assert.equal(parseDue("thursday", NOW), noon(2026, 11, 12));
  assert.equal(parseDue("wed", NOW), noon(2026, 11, 11));
  assert.equal(parseDue("mon", NOW), noon(2026, 11, 9));
  assert.equal(parseDue("sun", NOW), noon(2026, 11, 8));
});

test("parseDue: +Nd and +Nw offsets", () => {
  assert.equal(parseDue("+3d", NOW), noon(2026, 11, 8));
  assert.equal(parseDue("+0d", NOW), noon(2026, 11, 5));
  assert.equal(parseDue("+1w", NOW), noon(2026, 11, 12));
  assert.equal(parseDue("+2w", NOW), noon(2026, 11, 19));
  assert.equal(parseDue("+30d", NOW), noon(2026, 12, 5)); // crosses a month
});

test("parseDue: YYYY-MM-DD, rejecting dates that do not exist", () => {
  assert.equal(parseDue("2026-11-20", NOW), noon(2026, 11, 20));
  assert.equal(parseDue("2028-02-29", NOW), noon(2028, 2, 29)); // leap year
  assert.throws(() => parseDue("2026-02-31", NOW), CuError);
  assert.throws(() => parseDue("2026-02-29", NOW), CuError);
  assert.throws(() => parseDue("2026-13-01", NOW), CuError);
  assert.throws(() => parseDue("2026-00-10", NOW), CuError);
});

test("parseDue: garbage throws CuError, empty is null", () => {
  for (const s of ["yesterday", "next week", "3d", "+d", "+3x", "11/20/2026", "2026-1-5", "fri1", "+1000d"])
    assert.throws(() => parseDue(s, NOW), CuError, s);
  assert.equal(parseDue("", NOW), null);
  assert.equal(parseDue(undefined, NOW), null);
});

test("parseDue: result is always at local 12:00", () => {
  for (const s of ["today", "tomorrow", "fri", "+3d", "+1w", "2026-12-31"]) {
    const d = new Date(parseDue(s, NOW));
    assert.equal(d.getHours(), 12, s);
    assert.equal(d.getMinutes(), 0, s);
  }
});

// ── parsePriority ───────────────────────────────────────────────────────────
test("parsePriority: names and numbers", () => {
  assert.equal(parsePriority("urgent"), 1);
  assert.equal(parsePriority("high"), 2);
  assert.equal(parsePriority("normal"), 3);
  assert.equal(parsePriority("low"), 4);
  assert.equal(parsePriority(" HIGH "), 2);
  for (const n of [1, 2, 3, 4]) assert.equal(parsePriority(String(n)), n);
});

test("parsePriority: unknown throws, empty is null", () => {
  for (const s of ["0", "5", "medium", "hi", "1.0", "12"]) assert.throws(() => parsePriority(s), CuError, s);
  assert.equal(parsePriority(""), null);
  assert.equal(parsePriority(null), null);
  assert.equal(parsePriority(undefined), null);
});

// ── newer ───────────────────────────────────────────────────────────────────
test("newer compares x.y.z numerically", () => {
  assert.equal(newer("1.2.1", "1.2.0"), true);
  assert.equal(newer("1.10.0", "1.9.9"), true);
  assert.equal(newer("2.0.0", "1.99.99"), true);
  assert.equal(newer("1.2.0", "1.2.0"), false);
  assert.equal(newer("1.2.0", "1.2.1"), false);
  assert.equal(newer("1.9.9", "1.10.0"), false);
  assert.equal(newer("1.3", "1.2.9"), true); // missing part counts as 0
  assert.equal(newer("1.2", "1.2.0"), false);
});

// ── tagMessage ──────────────────────────────────────────────────────────────
test("tagMessage: -m style message gets a CU-<id> trailer", () => {
  assert.equal(tagMessage("fix: login\n", "86ex1abcd"), "fix: login\n\nCU-86ex1abcd\n");
  assert.equal(tagMessage("fix: login", "86ex1abcd"), "fix: login\n\nCU-86ex1abcd\n");
});

test("tagMessage: trailer goes before git comment lines", () => {
  const tpl = "feat: x\n\nbody line\n\n# Please enter the commit message\n# Lines starting with '#' are ignored\n";
  const out = tagMessage(tpl, "86ex1abcd");
  assert.equal(out, "feat: x\n\nbody line\n\nCU-86ex1abcd\n\n# Please enter the commit message\n# Lines starting with '#' are ignored\n");
  assert.ok(out.indexOf("CU-86ex1abcd") < out.indexOf("#"));
});

test("tagMessage: empty body (editor template only)", () => {
  const tpl = "\n# Please enter the commit message\n";
  const out = tagMessage(tpl, "86ex1abcd");
  assert.ok(out.includes("CU-86ex1abcd"));
  assert.ok(out.indexOf("CU-86ex1abcd") < out.indexOf("# Please"));
  assert.ok(out.endsWith("# Please enter the commit message\n"));
  assert.equal(tagMessage("", "86ex1abcd"), "\n\nCU-86ex1abcd\n");
});

test("tagMessage: leaves a message that already has a CU-<id> alone", () => {
  for (const m of ["fix: x CU-86ex1abcd\n", "fix: y\n\nCU-zzzzzzz\n", "feat: cu-abc1234 lower case\n"])
    assert.equal(tagMessage(m, "86ex1abcd"), m);
});

// ── buildReport ─────────────────────────────────────────────────────────────
// I18N is not exported: buildReport defaults to the English strings.
const T = (id, name) => ({ id, name });

test("buildReport: no entries gives the nothing line", () => {
  assert.equal(buildReport([], "Twaha", "2026-11-05"), "## Daily report · Twaha · 2026-11-05\n\nNothing recorded for this day.");
  assert.equal(buildReport(undefined, "Twaha", "2026-11-05"), "## Daily report · Twaha · 2026-11-05\n\nNothing recorded for this day.");
});

test("buildReport: sections, started-then-finished only under Finished, commits counted", () => {
  const a = T("a1", "Login page"), b = T("b1", "Search API"), c = T("c1", "Payments"), d = T("d1", "Docs"), e = T("e1", "Refactor");
  const entries = [
    { at: "09:00", kind: "plan", task: a, text: "" },
    { at: "09:00", kind: "plan", task: null, text: "read the RFC" },
    { at: "09:05", kind: "start", task: a, text: "" },
    { at: "10:00", kind: "commit", task: a, text: "feat: form" },
    { at: "11:00", kind: "finish", task: a, text: "shipped" },
    { at: "11:05", kind: "start", task: b, text: "" },
    { at: "12:00", kind: "start", task: c, text: "" },
    { at: "12:30", kind: "block", task: c, text: "waiting on keys" },
    { at: "13:00", kind: "start", task: d, text: "" },
    { at: "14:00", kind: "handoff", task: d, text: "Rafi" },
    { at: "15:00", kind: "start", task: e, text: "" },
    { at: "15:10", kind: "block", task: e, text: "flaky ci" },
    { at: "16:00", kind: "finish", task: e, text: "" },
    { at: "16:30", kind: "commit", task: null, text: "chore: deps" },
  ];
  const r = buildReport(entries, "Twaha", "2026-11-05");
  const sec = (title) => {
    const i = r.indexOf(`**${title}`);
    if (i < 0) return null;
    const j = r.indexOf("\n**", i + 2);
    return r.slice(i, j < 0 ? undefined : j);
  };
  assert.ok(r.startsWith("## Daily report · Twaha · 2026-11-05\n"));

  const finished = sec("Finished");
  assert.ok(finished.includes("- Login page: shipped"));
  assert.ok(finished.includes("- Refactor\n") || finished.trimEnd().endsWith("- Refactor"));

  const working = sec("In progress");
  assert.ok(working.includes("- Search API (11:05)"));
  for (const n of ["Login page", "Payments", "Docs", "Refactor"]) assert.ok(!working.includes(n), `${n} not in progress`);

  const blocked = sec("Blocked");
  assert.ok(blocked.includes("- Payments: waiting on keys"));
  assert.ok(!blocked.includes("Refactor"), "finished task is not blocked");

  assert.ok(sec("Handed over").includes("- Docs → Rafi"));

  const planned = sec("Planned");
  assert.ok(planned.includes("- Login page"));
  assert.ok(planned.includes("- read the RFC"));

  const commits = sec("Commits (2)");
  assert.ok(commits, "commits counted");
  assert.ok(commits.includes("- 10:00 feat: form · Login page"));
  assert.ok(commits.includes("- 16:30 chore: deps"));

  // "Login page" appears once among Finished/In progress/Blocked/Handed.
  const statusPart = r.slice(r.indexOf("**Finished"), r.indexOf("**Planned"));
  assert.equal(statusPart.split("Login page").length - 1, 1);
});

test("buildReport: empty sections are left out", () => {
  const r = buildReport([{ at: "10:00", kind: "commit", task: null, text: "x" }], "A", "2026-11-05");
  assert.ok(r.includes("**Commits (1)**"));
  for (const s of ["Finished", "In progress", "Blocked", "Handed over", "Planned"]) assert.ok(!r.includes(`**${s}`), s);
});

test("buildReport: uses a given translation table", () => {
  const tr = { report: "R", nothing: "N", finished: "F", working: "W", blocked: "B", handed: "H", planned: "P", commits: "C" };
  assert.equal(buildReport([], "x", "d", tr), "## R · x · d\n\nN");
  assert.ok(buildReport([{ at: "1", kind: "finish", task: T("a", "t"), text: "" }], "x", "d", tr).includes("**F**"));
});

// ── looksLikeToken / SETTINGS ───────────────────────────────────────────────
test("looksLikeToken", () => {
  assert.equal(looksLikeToken("pk_1234567890"), true);
  assert.equal(looksLikeToken("pk_12345678_ABCDEFGHIJ"), true);
  assert.equal(looksLikeToken("pk_123456789"), false); // 9 chars
  assert.equal(looksLikeToken("pk_12345-67890"), false);
  assert.equal(looksLikeToken("PK_1234567890"), false);
  assert.equal(looksLikeToken("xpk_1234567890"), false);
  assert.equal(looksLikeToken("pk_1234567890 "), false);
  assert.equal(looksLikeToken(""), false);
});

test("SETTINGS has the documented keys and defaults", () => {
  assert.deepEqual(Object.keys(SETTINGS).sort(), ["commit_tag", "lang", "slack_webhook", "timer", "token_store", "update_check"]);
  assert.equal(SETTINGS.lang.dflt, "en");
  assert.equal(SETTINGS.timer.dflt, "on");
  assert.equal(SETTINGS.commit_tag.dflt, "on");
  assert.equal(SETTINGS.update_check.dflt, "on");
  assert.equal(SETTINGS.slack_webhook.dflt, "");
  assert.equal(SETTINGS.token_store.dflt, "file");
  for (const [k, d] of Object.entries(SETTINGS)) {
    assert.ok("dflt" in d, k);
    if (d.values) assert.ok(d.values.includes(d.dflt), `${k} default is allowed`);
  }
});

// ── subprocess: completion, config, hook ────────────────────────────────────
function cuRun(args, { cwd = ROOT, confDir = freshDir() } = {}) {
  const env = { ...process.env, CU_CONFIG_DIR: confDir, CLICKUP_API_TOKEN: "", CI: "1" };
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: "utf8", timeout: 30000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("cu completion bash", () => {
  const r = cuRun(["completion", "bash"]);
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.includes("complete -F _cu cu"));
  for (const c of ["start", "report", "handoff", "config"]) assert.match(r.out, new RegExp(`\\b${c}\\b`), c);
  assert.ok(!r.out.includes("bashcompinit"));
});

test("cu completion zsh", () => {
  const r = cuRun(["completion", "zsh"]);
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.includes("bashcompinit"));
  assert.ok(r.out.includes("complete -F _cu cu"));
});

test("cu completion fish", () => {
  const r = cuRun(["completion", "fish"]);
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.includes("complete -c cu"));
  assert.ok(r.out.includes("start"));
});

test("cu completion with an unknown shell fails", () => {
  assert.notEqual(cuRun(["completion", "powershell"]).code, 0);
});

test("cu config lists the settings", () => {
  const r = cuRun(["config"]);
  assert.equal(r.code, 0, r.err);
  for (const k of Object.keys(SETTINGS)) assert.ok(r.out.includes(k), k);
});

test("cu config lang: set, read back, reject bad values", () => {
  const dir = freshDir();
  assert.equal(cuRun(["config", "lang"], { confDir: dir }).out.trim(), "en");
  const set = cuRun(["config", "lang", "bn"], { confDir: dir });
  assert.equal(set.code, 0, set.err);
  const get = cuRun(["config", "lang"], { confDir: dir });
  assert.equal(get.code, 0, get.err);
  assert.equal(get.out.trim(), "bn");
  assert.notEqual(cuRun(["config", "lang", "xx"], { confDir: dir }).code, 0);
  assert.equal(cuRun(["config", "lang"], { confDir: dir }).out.trim(), "bn"); // unchanged
  assert.notEqual(cuRun(["config", "nope", "x"], { confDir: dir }).code, 0);
});

test("cu config slack_webhook only accepts Slack webhook URLs", () => {
  const dir = freshDir();
  const bad = cuRun(["config", "slack_webhook", "https://evil.example.com"], { confDir: dir });
  assert.notEqual(bad.code, 0);
  for (const u of ["http://hooks.slack.com/services/T/B/x", "https://hooks.slack.com.evil.com/services/T/B/x"])
    assert.notEqual(cuRun(["config", "slack_webhook", u], { confDir: dir }).code, 0, u);
  const ok = cuRun(["config", "slack_webhook", "https://hooks.slack.com/services/T000/B000/abcDEF123"], { confDir: dir });
  assert.equal(ok.code, 0, ok.err);
  assert.ok(cuRun(["config"], { confDir: dir }).out.includes("set"));
  assert.equal(cuRun(["config", "slack_webhook", "off"], { confDir: dir }).code, 0);
});

const hasGit = spawnSync("git", ["--version"]).status === 0;

test("cu hook prepare-commit-msg in an unlinked repo leaves the message alone", { skip: !hasGit && "git not installed" }, () => {
  const repo = freshDir("cu-repo-");
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: repo }).status, 0);
  const msg = path.join(repo, "COMMIT_EDITMSG");
  const text = "fix: something\n\n# Please enter the commit message\n";
  fs.writeFileSync(msg, text);
  const r = cuRun(["hook", "prepare-commit-msg", msg, "message"], { cwd: repo });
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(msg, "utf8"), text);
});

test("parseDue rejects words that only start like a weekday", async () => {
  const { parseDue, CuError } = await import("../lib/cu.js");
  const now = new Date(2026, 10, 5, 9, 30);
  for (const w of ["frisbee", "sunny", "monster", "satellite", "tues"]) assert.throws(() => parseDue(w, now), CuError, w);
  assert.equal(new Date(parseDue("tue", now)).getDate(), 10);
  assert.equal(new Date(parseDue("tuesday", now)).getDate(), 10);
});

test("a missing token is reported as setup, not as a network problem", () => {
  const conf = fs.mkdtempSync(path.join(os.tmpdir(), "cu-notoken-"));
  const r = spawnSync(process.execPath, [BIN, "doctor"],
    { encoding: "utf8", env: { ...process.env, CU_CONFIG_DIR: conf, CLICKUP_API_TOKEN: "", CI: "1" } });
  assert.match(r.stdout, /no working ClickUp token/);
  assert.doesNotMatch(r.stdout, /cannot be reached/);
});
