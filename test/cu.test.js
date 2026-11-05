import { test } from "node:test";
import assert from "node:assert/strict";
import { statusName, refFromText, opts, ago, main } from "../lib/cu.js";

const LMS = [
  { name: "backlog", type: "open" }, { name: "todo", type: "custom" }, { name: "in progress", type: "custom" },
  { name: "in review", type: "custom" }, { name: "blocked", type: "custom" }, { name: "done", type: "closed" },
];
const DEFAULT = [{ name: "to do", type: "open" }, { name: "in progress", type: "custom" }, { name: "complete", type: "closed" }];

test("statusName uses the exact name when the space has it", () => {
  assert.equal(statusName("todo", LMS), "todo");
  assert.equal(statusName("In Review", LMS), "in review");
  assert.equal(statusName("blocked", LMS), "blocked");
  assert.equal(statusName("done", LMS), "done");
});

test("statusName maps onto a space's own names", () => {
  assert.equal(statusName("todo", DEFAULT), "to do");
  assert.equal(statusName("in progress", DEFAULT), "in progress");
  assert.equal(statusName("done", DEFAULT), "complete");
  assert.equal(statusName("in review", DEFAULT), null);
  assert.equal(statusName("blocked", DEFAULT), null);
  assert.equal(statusName("nonsense", DEFAULT), null);
});

test("refFromText finds CU-<id> only", () => {
  assert.equal(refFromText("feat(x): CU-86ex1abcd add y"), "86ex1abcd");
  assert.equal(refFromText("feat/cu-z8rp3ffbf1-login"), "z8rp3ffbf1");
  assert.equal(refFromText("feat(x): T-65 add y"), null);
});

test("opts splits flags from positional args", () => {
  assert.deepEqual(opts(["a", "--list", "Sprints", "b"], "list"), [["a", "b"], { list: "Sprints" }]);
  assert.deepEqual(opts(["--other", "x"], "list"), [["--other", "x"], {}]);
  assert.deepEqual(opts(["a", "--list"], "list"), [["a"], { list: null }]);
});

test("ago is human readable", () => {
  const now = 1_000_000_000_000;
  assert.equal(ago(now - 30_000, now), "just now");
  assert.equal(ago(now - 5 * 60_000, now), "5m ago");
  assert.equal(ago(now - 3 * 3_600_000, now), "3h ago");
  assert.equal(ago(now - 2 * 86_400_000, now), "2d ago");
  assert.equal(ago("x", now), "?");
});

test("main prints usage for help and fails for unknown commands", async () => {
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(await main([]), 0);
    assert.equal(await main(["help"]), 0);
    assert.equal(await main(["nope"]), 1);
  } finally {
    console.log = log;
  }
});

import { apiBase, isId, shQuote } from "../lib/cu.js";
import { execFileSync } from "node:child_process";

test("the token only goes to ClickUp or localhost", () => {
  assert.equal(apiBase(undefined), "https://api.clickup.com/api/v2");
  assert.equal(apiBase("http://127.0.0.1:9/"), "http://127.0.0.1:9");
  assert.equal(apiBase("http://localhost:3000/api"), "http://localhost:3000/api");
  assert.throws(() => apiBase("https://evil.example.com/api"));
  assert.throws(() => apiBase("http://localhost.evil.com"));
  assert.throws(() => apiBase("not a url"));
});

test("ids used in API paths are plain alphanumerics", () => {
  assert.ok(isId("90182584045"));
  assert.ok(isId("z8rp3ffbf1"));
  assert.ok(!isId("../user"));
  assert.ok(!isId("123/comment"));
  assert.ok(!isId(""));
  assert.ok(!isId(undefined));
});

test("shQuote survives quotes, spaces and $ in sh", () => {
  for (const v of ["/plain/path", "/with space/x", "it's", 'a"b', "$(touch /tmp/pwned)", "`id`"]) {
    assert.equal(execFileSync("sh", ["-c", `printf %s ${shQuote(v)}`], { encoding: "utf8" }), v);
  }
});
