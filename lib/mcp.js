// MCP server for cusync: gives any AI tool (Claude, Cursor, Codex, Copilot, Windsurf...) ClickUp tools over stdio.
// JSON-RPC 2.0, one message per line. No dependencies.
import readline from "node:readline";
import { runCaptured, agentRules, VERSION } from "./cu.js";

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const repoPath = {
  type: "string",
  description: "Absolute path of the project folder (a git repo linked with cusync). Defaults to the folder the AI tool runs in.",
};
const task = { type: "string", description: "ClickUp task id (86ex1abcd), part of the task name, or \".\" for the current task." };
const schema = (props = {}, required = []) => ({
  type: "object",
  properties: { ...props, repo_path: repoPath },
  required,
  additionalProperties: false,
});

function str(a, key, required = true) {
  const v = a[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new Error(`"${key}" is required`);
    return null;
  }
  if (typeof v !== "string") throw new Error(`"${key}" must be a string`);
  return v;
}

const opt = (flag, v) => (v ? [flag, v] : []);
const due = { type: "string", description: "Due date, only if the user gave one: today, tomorrow, mon..sun, +3d, +1w or YYYY-MM-DD." };
const priority = { type: "string", enum: ["urgent", "high", "normal", "low"], description: "Only if the user gave one." };
const dp = (a) => [...opt("--due", str(a, "due", false)), ...opt("--priority", str(a, "priority", false))];

export const TOOLS = [
  {
    name: "clickup_where",
    description: "Which ClickUp space this project is linked to, and the current task. Use it to check that cusync is set up.",
    inputSchema: schema(),
    annotations: { readOnlyHint: true },
    run: () => ["where", []],
  },
  {
    name: "clickup_my_tasks",
    description: "List the developer's open ClickUp tasks in this project's space (current task marked ▶). Check this before planning so nothing is duplicated.",
    inputSchema: schema({ include_backlog: { type: "boolean", description: "Also list backlog tasks." } }),
    annotations: { readOnlyHint: true },
    run: (a) => ["mine", a.include_backlog ? ["--all"] : []],
  },
  {
    name: "clickup_team",
    description: "Who is working on what right now: everyone's tasks that are in progress, blocked or in review in this space.",
    inputSchema: schema(),
    annotations: { readOnlyHint: true },
    run: () => ["team", []],
  },
  {
    name: "clickup_show_task",
    description: "Show one task: status, assignees, list and link.",
    inputSchema: schema({ task }, ["task"]),
    annotations: { readOnlyHint: true },
    run: (a) => ["show", [str(a, "task")]],
  },
  {
    name: "clickup_plan_day",
    description: "Plan the day: create each title as a task in todo, in the developer's own list. Use when the user says what they will work on today.",
    inputSchema: schema({ titles: { type: "array", items: { type: "string" }, minItems: 1, description: "Short task titles." },
      list: { type: "string", description: "Optional list name, only when the user asks for a specific list." }, due, priority }, ["titles"]),
    run: (a) => {
      if (!Array.isArray(a.titles) || !a.titles.length || a.titles.some((t) => typeof t !== "string" || !t.trim()))
        throw new Error('"titles" must be a non-empty list of strings');
      return ["today", [...a.titles, ...opt("--list", str(a, "list", false)), ...dp(a)]];
    },
  },
  {
    name: "clickup_start_task",
    description: "Start working on a task before writing code: finds a matching task or creates it, moves it to in progress and makes it current, so commits are logged on it.",
    inputSchema: schema({ task: { type: "string", description: "Task id, part of its name, or a new title." },
      parent: { type: "string", description: "Optional parent task, to create a subtask." }, due, priority }, ["task"]),
    run: (a) => ["start", [str(a, "task"), ...opt("--parent", str(a, "parent", false)), ...dp(a)]],
  },
  {
    name: "clickup_comment",
    description: "Post a progress note for the team: what was done, what is left, what blocks. Defaults to the current task.",
    inputSchema: schema({ text: { type: "string" }, task }, ["text"]),
    run: (a) => ["comment", a.task ? [str(a, "task"), str(a, "text")] : [str(a, "text")]],
  },
  {
    name: "clickup_finish_task",
    description: "The current task's work is finished (tests pass): posts the summary and moves it to in review. Does not mark it done.",
    inputSchema: schema({ summary: { type: "string", description: "What was done, for the teammate who reads it." } }, ["summary"]),
    run: (a) => ["finish", [str(a, "summary")]],
  },
  {
    name: "clickup_block_task",
    description: "The current task is blocked: moves it to blocked with what it waits for.",
    inputSchema: schema({ reason: { type: "string" } }, ["reason"]),
    run: (a) => ["block", [str(a, "reason")]],
  },
  {
    name: "clickup_set_status",
    description: "Set any status of the space on a task (todo, in progress, in review, done...). Only mark done when the user confirms it is merged and tested.",
    inputSchema: schema({ task, status: { type: "string" } }, ["task", "status"]),
    run: (a) => ["status", [str(a, "task"), str(a, "status")]],
  },
  {
    name: "clickup_add_task",
    description: "Create one task in todo (or a subtask with parent) without starting it.",
    inputSchema: schema({ title: { type: "string" }, description: { type: "string" },
      parent: { type: "string", description: "Optional parent task." }, list: { type: "string", description: "Optional list name." }, due, priority }, ["title"]),
    run: (a) => ["add", [str(a, "title"), ...opt("--desc", str(a, "description", false)),
      ...opt("--parent", str(a, "parent", false)), ...opt("--list", str(a, "list", false)), ...dp(a)]],
  },
  {
    name: "clickup_pr",
    description: "A pull request was opened: links it on the task (PR field if the list has one) and moves the task to in review.",
    inputSchema: schema({ url: { type: "string" }, task }, ["url"]),
    run: (a) => ["pr", a.task ? [str(a, "task"), str(a, "url")] : [str(a, "url")]],
  },
  {
    name: "clickup_pause_timer",
    description: "Stop the ClickUp timer (a break); the task stays current and its status does not change.",
    inputSchema: schema(),
    run: () => ["pause", []],
  },
  {
    name: "clickup_handoff",
    description: "Give a task to a teammate when the user asks: assigns them, unassigns the developer, leaves a note. Defaults to the current task.",
    inputSchema: schema({ to: { type: "string", description: "Teammate's name or email name as in ClickUp." },
      note: { type: "string", description: "What they need to know." }, task }, ["to"]),
    run: (a) => ["handoff", [str(a, "to"), ...(str(a, "note", false) ? [a.note] : []), ...opt("--task", str(a, "task", false))]],
  },
  {
    name: "clickup_daily_report",
    description: "What the developer did on a day (started, finished, blocked, handed over, planned, commits), from cusync's local log. Use it to write a standup or end-of-day summary.",
    inputSchema: schema({ date: { type: "string", description: "YYYY-MM-DD, default today." } }),
    annotations: { readOnlyHint: true },
    run: (a) => ["report", opt("--date", str(a, "date", false))],
  },
  {
    name: "clickup_report_bug",
    description: "Open a bug in the space's bug list (or the developer's own list).",
    inputSchema: schema({ title: { type: "string" }, details: { type: "string" } }, ["title"]),
    run: (a) => ["bug", [str(a, "title"), ...(str(a, "details", false) ? [a.details] : [])]],
  },
];

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

export async function handle(msg) {
  const { id, method, params = {} } = msg || {};
  const isRequest = id !== undefined && id !== null;
  const reply = (result) => isRequest && send({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => isRequest && send({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "cusync", title: "cusync (ClickUp)", version: VERSION },
        instructions: agentRules(""),
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params.name}`);
      const args = params.arguments || {};
      let cmd, cmdArgs;
      try {
        [cmd, cmdArgs] = tool.run(args);
      } catch (e) {
        return reply({ content: [{ type: "text", text: e.message }], isError: true });
      }
      const r = await runCaptured(cmd, cmdArgs, typeof args.repo_path === "string" && args.repo_path ? args.repo_path : null);
      return reply({ content: [{ type: "text", text: r.text }], isError: !r.ok });
    }
    default:
      if (method?.startsWith("notifications/")) return; // initialized, cancelled, ...
      return fail(-32601, `Method not found: ${method}`);
  }
}

export function startMcp() {
  const rl = readline.createInterface({ input: process.stdin });
  let chain = Promise.resolve();
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    chain = chain.then(() => handle(msg)).catch((e) =>
      msg?.id != null && send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: e.message } }));
  });
  rl.on("close", () => chain.then(() => process.exit(0)));
}
