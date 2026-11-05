<div align="center">

# cusync

**ClickUp from your terminal and git.** Install with `npx cusync`, then use the `cu` command.

Plan the day, start and finish tasks, and log every commit on the task you are working on,
without leaving the terminal and without defining tasks in advance.

[![npm](https://img.shields.io/npm/v/cusync.svg)](https://www.npmjs.com/package/cusync)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen.svg)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](package.json)

</div>

---

## Why

Task boards drift out of date because updating them is a separate chore. `cu` makes the update a side effect of
the work you already do:

- **You commit, ClickUp knows.** A git hook posts each commit to the task you are working on.
- **Nothing to set up in advance.** `cu start "fix login redirect"` finds the task or creates it.
- **The board shows who does what.** Every developer gets a personal list in the space, and `cu team` prints
  who is working on what right now.
- **Your AI does it for you.** Claude Code, Cursor, Codex, Copilot, Windsurf or any MCP client can drive `cu`: tell
  it what you will work on today and it keeps ClickUp in sync while it codes.

## Features

- Daily flow in four commands: `today`, `start`, `finish`, `block`
- Automatic commit logging through git hooks that never block a commit
- One ClickUp space per repo, so several projects can run side by side
- Status names matched to each space (`to do`, `complete`, and so on)
- Offline queue: commit logs made without a network are sent later
- A single catch-all task per day for commits made without a current task, so tiny tasks do not pile up
- Works with AI agents: rules for every agent, a Claude Code plugin, and an MCP server
- Nothing is written to your repository's tracked files
- Zero runtime dependencies. Needs Node 18.17 or later and git.

## Get started

Open a terminal in your project and run **one command**:

```bash
npx cusync
```

A short guided setup follows. It takes about a minute:

```
👋 cu setup for my-app

Step 1 of 2 · ClickUp token
  Open that page in your browser now? [Y/n]           ← opens ClickUp → Settings → Apps
  Paste the token (starts with pk_, it will not be shown):
  ✔ signed in as Jane Doe

Step 2 of 2 · Which ClickUp space is my-app tracked in?
   1) Marketing
   2) Product
  Type a number: 2
  ✔ space: Product
  ✔ your list: 👤 Jane Doe (your new tasks go here)
  ✔ git hooks on in my-app

Install the `cu` command permanently? [Y/n]

🎉 All set: commits in my-app are now logged in ClickUp.
```

That's it. For your next project, open it and run `cu setup` (or just `cu`). The token is remembered, so only the
space question is asked.

<details>
<summary>Other ways to install</summary>

```bash
npm i -g cusync                    # install the `cu` command first
cd path/to/your-repo && cu setup   # then link each repo
```

Latest code from GitHub: `npm i -g github:twahanur/cu-clickup`.

Without a terminal prompt (scripts, CI): `cu setup --token pk_... --space "Product"`.

</details>

**Something not working?** Run `cu doctor`. It checks Node, git, your token, the repo link and the hooks, and
prints the fix for anything that is wrong.

**What setup changes:** your token goes to `~/.config/clickup/token` (readable only by you), the repo gets local
git settings and hooks, and a git-ignored `CLAUDE.local.md` is written for Claude Code. Nothing is committed.

### Your first day

```bash
cu today "Login page" "Password reset email"   # plan the day: two tasks in todo
cu start "Login page"                           # in progress, now the current task
git commit -m "feat(auth): login form"          # logged on "Login page"
cu comment "Form done, validation left"         # progress note
cu finish "Login page with validation"          # summary, then in review
```

## Commands

### Daily flow

| Command | Effect in ClickUp |
|---|---|
| `cu today "<title>" ["<title>" ...] [--list L]` | Creates each title as a task in **todo** |
| `cu start <ref \| "new title"> [--list L] [--parent REF]` | Moves to **in progress** and makes it the current task. Creates it if nothing matches |
| `cu comment [<ref>] "<text>"` | Comments on the current task, or on `<ref>` |
| `cu finish ["<summary>"]` | Comments the summary, moves to **in review**, clears the current task |
| `cu block "<reason>"` | Moves the current task to **blocked** with a comment |

### Overview

| Command | Shows |
|---|---|
| `cu team` | Everyone's tasks that are in progress, blocked or in review in this space |
| `cu mine [--all]` | Your open tasks in this space. The current task is marked `▶` |
| `cu current` | The current task |
| `cu show <ref>` | One task: status, assignees, list, link |
| `cu where` | Which workspace and space this folder is linked to |
| `cu lists` / `cu statuses` | Lists and statuses of the space |

### Other

| Command | Effect |
|---|---|
| `cu setup` (or just `cu`) | Guided setup: token, space, hooks. Rerun to switch space. Flags: `--space <name>`, `--token pk_...` |
| `cu doctor` | Checks everything and prints the fix for each problem |
| `cu add "<title>" [--list L] [--parent REF] [--desc D]` | Creates one task in **todo**, or a subtask with `--parent` |
| `cu status <ref> <status>` | Sets any status of the space |
| `cu pr [<ref>] <url>` | Fills a PR link field if the list has one, then moves to **in review** |
| `cu bug "<title>" ["<details>"]` | Creates a bug in the space's bug list, or in your own list |
| `cu tasks [file]` | Writes all your tasks in the space as a Markdown checklist |
| `cu agents` | Connects your AI tools (Cursor MCP, Claude Code plugin) and prints MCP config for others |
| `cu mcp` | Runs the MCP server. AI tools start this themselves |
| `cu version` | Prints the version |

### Task references

A `<ref>` can be:

- a ClickUp task id: `86ex1abcd`
- the same id with a prefix: `CU-86ex1abcd`
- `.` for the current task
- any part of the name of one of your open tasks: `"login page"`. If several tasks match, `cu` lists them.

## How it works

```
cu start "Login page"   ─────►  task "Login page" → in progress, saved as current
git commit              ─────►  post-commit hook ─► comment on the current task
                                 │
                                 ├─ message contains CU-<id>  → that task instead
                                 ├─ no current task          → today's catch-all task
                                 └─ offline                  → queued, sent later
cu finish "summary"     ─────►  comment + in review, current cleared
```

**Statuses.** `cu` reads the statuses of each space and maps `todo`, `in progress`, `in review`, `blocked` and
`done` to the space's own names. A space with `to do / in progress / complete` works without configuration. If a
space has no matching status, for example no `blocked`, the status is left alone and only the comment is added.

**Current task.** There is one current task per space, shared by every repo linked to that space on your machine.

**Commits without a task.** These go to one catch-all task per day, named `🗒 <Name>: অন্যান্য কাজ <date>`
("other work"), so a forgotten `cu start` does not create a new task for every commit.

**Branches.** Creating a branch whose name contains `CU-<id>`, for example
`git checkout -b feat/CU-86ex1abcd-login`, starts that task. Checking out a colleague's existing branch changes
nothing.

**Offline.** If ClickUp cannot be reached, the commit still succeeds and its log is saved to
`~/.config/clickup/queue.json`. The next commit or `cu` command sends it, with the time it was saved.

**Hooks never block git.** Any error inside a hook is printed as one line and the commit or checkout goes through.

## Use it with AI agents

Most of us code with an AI now, so `cu` is built to be driven by one. Tell your agent what you will work on today
and it plans the tasks, starts the right one before writing code, posts progress, and finishes it with a summary.
You never type a `cu` command unless you want to.

There are three ways an agent learns about `cu`. `cu setup` sets up the first one for you and offers the others.

**1. Rules in the repo (every agent).** `cu setup` writes the same short instructions for each agent, all kept out
of git:

| Agent | File |
|---|---|
| Claude Code | `CLAUDE.local.md` |
| Cursor | `.cursor/rules/cusync.mdc` |
| Codex, GitHub Copilot, Windsurf and other `AGENTS.md` readers | `AGENTS.md` (skipped if your repo already tracks one) |

**2. Claude Code plugin.** It adds a `clickup` skill, the MCP tools below, and a session hook that tells Claude which
task is current when a session starts. Run this once inside Claude Code:

```
/plugin install cusync --marketplace twahanur/cu-clickup
```

On older Claude Code versions: `/plugin marketplace add twahanur/cu-clickup`, then `/plugin install cusync@cusync`.

**3. MCP server (Cursor, Claude Desktop, Windsurf, VS Code and any MCP client).** Your agent calls ClickUp tools
directly instead of typing commands. `cu agents` adds it to Cursor for you and prints the config for other clients:

```json
{ "mcpServers": { "cusync": { "command": "npx", "args": ["-y", "cusync", "mcp"] } } }
```

| Tool | Does |
|---|---|
| `clickup_plan_day` | Creates today's tasks in todo |
| `clickup_start_task` | Finds or creates a task, moves it to in progress, makes it current |
| `clickup_comment` | Posts a progress note |
| `clickup_finish_task` | Posts a summary, moves to in review |
| `clickup_block_task` | Moves to blocked with the reason |
| `clickup_pr` | Links a pull request, moves to in review |
| `clickup_set_status` | Sets any status |
| `clickup_add_task` / `clickup_report_bug` | Creates a task, subtask or bug |
| `clickup_my_tasks` / `clickup_team` / `clickup_show_task` / `clickup_where` | Reads: your tasks, who does what, one task, setup |

Each tool takes an optional `repo_path` for agents that work across several projects.

**What agents do on their own.** They change only your own tasks, tell you in one line what they changed, never mark
a task done until you confirm it is merged and tested, and ask you to run `npx cusync` if a repo is not set up yet.
The token never reaches the agent: the tools run locally with the token on your machine.

## Configuration

Everything lives in `~/.config/clickup/`:

| File | Contents |
|---|---|
| `token` | Your ClickUp API token (mode `600`) |
| `config.json` | Default space and your personal list per space |
| `state.json` | Current task and today's catch-all task per space |
| `queue.json` | Commit logs waiting to be sent |
| `hooks/` | The git hook scripts used by linked repos |

Each linked repository gets only local git settings (`clickup.space`, `clickup.workspace`, `clickup.spacename`,
`core.hooksPath`) and the git-ignored agent rule files listed above.

| Environment variable | Purpose |
|---|---|
| `CLICKUP_API_TOKEN` | Use this token instead of the saved one |
| `CU_CONFIG_DIR` | Use another folder instead of `~/.config/clickup` |

## Security and privacy

- **Your token stays on your machine.** It is stored in `~/.config/clickup/token`. The folder is `700` and every
  file in it is `600`, so other users on the computer cannot read your token, tasks or commit messages.
- **The token is only sent to `api.clickup.com`.** No other server ever receives it. The test-only
  `CU_API_BASE` override is refused unless it points to `localhost`, so a hostile environment variable cannot
  redirect the token. The token is never passed on to other programs that `cu` starts, such as `npm` or the browser.
- **The prompt hides the token.** `cu setup --token pk_...` also works, but the value then stays in your shell
  history. Prefer the prompt.
- **Nothing is committed.** Repos get local git settings and a `CLAUDE.local.md` listed in `.git/info/exclude`. If a
  repo ships `CLAUDE.local.md` as a symlink, `cu` refuses to write through it.
- **Hooks are plain, quoted shell scripts** in `~/.config/clickup/hooks/`. You can read them. They never block a
  commit.
- **Only your own work is touched.** Tasks are created for you and assigned to you. Name matching only searches
  your own tasks. Another person's task changes only when you pass its id yourself.
- **Quiet comments.** Commit logs are posted with `notify_all: false`, so they do not notify the whole team.
- **No dependencies and no install scripts.** The package is a single readable file, [`lib/cu.js`](lib/cu.js).

Found a security problem? See [SECURITY.md](SECURITY.md).

## Troubleshooting

| Problem | Fix |
|---|---|
| Not sure what is wrong | `cu doctor` |
| `cu: command not found` | `npm i -g cusync`, and make sure `$(npm prefix -g)/bin` is on your `PATH` |
| `... is not linked to a ClickUp space yet` | Answer **Y** when `cu` offers to set it up, or run `cu setup` |
| `ClickUp did not accept that token` | Copy a fresh token and run `cu setup` again |
| Commits are not logged | Run `cu setup` in the repo, then check `git config core.hooksPath` |
| `This space has no "blocked" status` | Expected for spaces without that status. See `cu statuses` |

## Uninstall

```bash
# in each linked repo
git config --unset core.hooksPath
git config --unset clickup.space
git config --unset clickup.workspace
git config --unset clickup.spacename
rm -f CLAUDE.local.md .cursor/rules/cusync.mdc   # or remove only the "cusync" section
# AGENTS.md: remove the section between <!-- cusync:start --> and <!-- cusync:end -->

npm uninstall -g cusync
rm -rf ~/.config/clickup
# Cursor: remove "cusync" from ~/.cursor/mcp.json · Claude Code: /plugin uninstall cusync
```

## Development

```bash
git clone https://github.com/twahanur/cu-clickup.git
cd cu-clickup
npm test          # unit tests, no network
npm link          # use your working copy as the global `cu`
```

The code is a single module, [`lib/cu.js`](lib/cu.js), with no dependencies.
Issues and pull requests are welcome.

## License

[MIT](LICENSE) © Twahanur Rahman
