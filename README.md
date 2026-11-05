<div align="center">

# clickup-flow

**ClickUp from your terminal and git.** Install with `npx clickup-flow`, then use the `cu` command.

Plan the day, start and finish tasks, and log every commit on the task you are working on,
without leaving the terminal and without defining tasks in advance.

[![npm](https://img.shields.io/npm/v/clickup-flow.svg)](https://www.npmjs.com/package/clickup-flow)
[![Tests](https://github.com/twahanur/cu-clickup/actions/workflows/test.yml/badge.svg)](https://github.com/twahanur/cu-clickup/actions/workflows/test.yml)
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
- `cu start` with no arguments opens a picker of your open tasks
- Due dates and priorities in plain words: `--due fri --priority high`
- ClickUp time tracking that starts and stops with your tasks
- Automatic commit logging through git hooks that never block a commit
- A `CU-<id>` line added to each commit message, so ClickUp's own GitHub integration links the commit too
- Hand a task over to a teammate with a note: `cu handoff sara "API done, UI left"`
- A daily report built from what you did, printed or posted to Slack or ClickUp
- An optional GitHub Action that moves tasks to done when their pull request is merged
- One ClickUp space per repo, so several projects can run side by side
- Status names matched to each space (`to do`, `complete`, and so on)
- Offline queue: commit logs made without a network are sent later
- A single catch-all task per day for commits made without a current task, so tiny tasks do not pile up
- Works with AI agents: rules for every agent, a Claude Code plugin, and an MCP server
- Token in a file or in the system keychain (macOS Keychain, Linux Secret Service)
- Nothing is written to your repository's tracked files unless you ask for the GitHub Action
- Zero runtime dependencies. Needs Node 18.17 or later and git.

## Get started

Open a terminal in your project and run **one command**:

```bash
npx clickup-flow
```

A short guided setup follows. It takes about a minute:

```
👋 cu setup for my-app

Step 1 of 2 · ClickUp token
  Open that page in your browser now? [Y/n]           ← opens ClickUp → Settings → Apps
  Paste the token (starts with pk_, it will not be shown):
  Keep the token in your system keychain (safer than a file)? [Y/n]
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

The keychain question only appears when a system keychain is available. That's it. For your next project, open it
and run `cu setup` (or just `cu`). The token is remembered, so only the space question is asked.

<details>
<summary>Other ways to install</summary>

```bash
npm i -g clickup-flow                    # install the `cu` command first
cd path/to/your-repo && cu setup   # then link each repo
```

Latest code from GitHub: `npm i -g github:twahanur/cu-clickup`.

Without a terminal prompt (scripts, CI): `cu setup --token pk_... --space "Product"`.

</details>

**Something not working?** Run `cu doctor`. It checks Node, git, your token, the repo link and the hooks, and
prints the fix for anything that is wrong.

**What setup changes:** your token goes to the system keychain or to `~/.config/clickup/token` (readable only by
you), the repo gets local git settings and hooks, and a git-ignored `CLAUDE.local.md` is written for Claude Code.
Nothing is committed.

**Tab completion.** Add one line to your shell's startup file yourself:

```bash
eval "$(cu completion bash)"     # ~/.bashrc
eval "$(cu completion zsh)"      # ~/.zshrc
cu completion fish | source      # ~/.config/fish/config.fish
```

### Your first day

```bash
cu today "Login page" "Password reset email" --due fri   # plan the day: two tasks in todo
cu start "Login page"                           # in progress, now the current task, timer running
git commit -m "feat(auth): login form"          # logged on "Login page", message gets CU-<id>
cu comment "Form done, validation left"         # progress note
cu finish "Login page with validation"          # summary, then in review, timer stopped
cu report --slack                               # what you did today, posted to Slack
```

## Commands

### Daily flow

| Command | Effect in ClickUp |
|---|---|
| `cu today "<title>" ["<title>" ...] [--list L] [--due D] [--priority P]` | Creates each title as a task in **todo** |
| `cu start [<ref \| "new title">] [--list L] [--parent REF] [--due D] [--priority P]` | Moves to **in progress**, makes it the current task and starts the timer. Creates it if nothing matches. With no argument, opens a picker |
| `cu comment [<ref>] "<text>"` | Comments on the current task, or on `<ref>` |
| `cu pause` | Stops the timer. The status and the current task stay as they are. `cu start .` resumes |
| `cu finish ["<summary>"]` | Comments the summary, moves to **in review**, stops the timer, clears the current task |
| `cu block "<reason>"` | Moves the current task to **blocked** with a comment and stops the timer |
| `cu handoff <person> ["<note>"] [--task REF]` | Assigns the current task (or `REF`) to a teammate, removes you, and comments the note. Stops the timer if it was your current task |
| `cu report [--date YYYY-MM-DD] [--slack] [--clickup]` | Prints your daily report. `--slack` posts it to your Slack webhook, `--clickup` on the day's catch-all task |

**Picking a task.** `cu start` with no arguments lists your open tasks, in progress first, then todo, blocked and
in review. Type to filter, move with the arrow keys, press Enter to start one or Esc to cancel. The last entry,
"＋ a new task…", asks for a title and creates it.

**Due dates and priorities.** `--due` accepts `today`, `tomorrow`, a weekday (`mon` to `sun`, the next one to
come), `+3d`, `+1w` or `YYYY-MM-DD`. `--priority` accepts `urgent`, `high`, `normal` or `low`. Both work on
`cu today`, `cu add` and on `cu start` when it creates a new task.

**Handing over.** `<person>` is part of a teammate's ClickUp name, or the part of their email before the `@`. If
several people match, `cu` lists them.

**Daily report.** `cu` keeps a short local diary of what you started, finished, blocked, handed over, planned and
committed. `cu report` builds the day's report from it, without asking ClickUp. The diary stays on your machine
for 14 days and is only sent when you pass `--slack` or `--clickup`. Set the Slack webhook once with
`cu config slack_webhook https://hooks.slack.com/services/...`.

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
| `cu config [<name> [<value>]]` | Shows all settings, one setting, or changes one. See [Configuration](#configuration) |
| `cu add "<title>" [--list L] [--parent REF] [--desc D] [--due D] [--priority P]` | Creates one task in **todo**, or a subtask with `--parent` |
| `cu status <ref> <status>` | Sets any status of the space |
| `cu pr [<ref>] <url>` | Fills a PR link field if the list has one, then moves to **in review** |
| `cu bug "<title>" ["<details>"]` | Creates a bug in the space's bug list, or in your own list |
| `cu tasks [file]` | Writes all your tasks in the space as a Markdown checklist |
| `cu github-action [--force]` | Writes a GitHub workflow that moves tasks to done when their pull request is merged |
| `cu completion bash \| zsh \| fish` | Prints a tab completion script for your shell |
| `cu agents` | Connects your AI tools (Cursor MCP, Claude Code plugin) and prints MCP config for others |
| `cu mcp` | Runs the MCP server. AI tools start this themselves |
| `cu version` | Prints the version |

### Task references

A `<ref>` can be:

- a ClickUp task id: `86ex1abcd`
- the same id with a prefix: `CU-86ex1abcd`
- `.` for the current task
- any part of the name of one of your open tasks: `"login page"`. If several tasks match, `cu` lists them.

### Merged pull requests

`cu github-action` writes `.github/workflows/clickup-flow-merged.yml`. When a pull request is merged, the workflow finds
every `CU-<id>` in its title, body, branch name and commits, moves those tasks to **done** and comments the PR
link on each. Commits made with `cu` already carry their `CU-<id>`.

This file is for the whole team, so unlike everything else `cu` writes, it is meant to be committed. After you
push it, once per repository:

```bash
gh secret set CLICKUP_API_TOKEN                     # a ClickUp token that may edit the tasks
gh variable set CLICKUP_DONE_STATUS --body "qa"     # optional: another status than "done"
```

Without the secret, the workflow skips itself. `cu github-action` asks before replacing an existing file; pass
`--force` to replace it without asking.

## How it works

```
cu start "Login page"   ─────►  task "Login page" → in progress, saved as current, timer started
git commit              ─────►  prepare-commit-msg hook ─► adds CU-<id> of the current task to the message
                        ─────►  post-commit hook ─► comment on the current task
                                 │
                                 ├─ message contains CU-<id>  → that task instead
                                 ├─ no current task          → today's catch-all task
                                 └─ offline                  → queued, sent later
cu finish "summary"     ─────►  comment + in review, timer stopped, current cleared
```

**Statuses.** `cu` reads the statuses of each space and maps `todo`, `in progress`, `in review`, `blocked` and
`done` to the space's own names. A space with `to do / in progress / complete` works without configuration. If a
space has no matching status, for example no `blocked`, the status is left alone and only the comment is added.

**Current task.** There is one current task per space, shared by every repo linked to that space on your machine.

**Commit messages.** While you have a current task, each commit message gets a last line `CU-<id>` with that
task's id. ClickUp's own GitHub integration uses the same line to link the commit to the task, and
`cu github-action` uses it on merge. The line is not added when the message already names a task, for merge and
squash commits, for `git commit --amend`, or when there is no current task. Turn it off with
`cu config commit_tag off`.

**Commits without a task.** These go to one catch-all task per day, named `🗒 <Name>: Other work <date>`, so a
forgotten `cu start` does not create a new task for every commit. With `cu config lang bn` the name is
`🗒 <Name>: অন্যান্য কাজ <date>`.

**Amend and rebase.** An amended, rebased or cherry-picked commit is not logged again: the original was logged
already.

**Time tracking.** `cu start` starts the ClickUp timer on the task, after stopping any timer that was running.
`cu finish`, `cu block` and `cu handoff` stop it, and `cu pause` stops it without changing anything else. A timer
error is printed as one line and never fails the command. Turn it off with `cu config timer off`.

**Branches.** Creating a branch whose name contains `CU-<id>`, for example
`git checkout -b feat/CU-86ex1abcd-login`, starts that task. Checking out a colleague's existing branch changes
nothing.

**Offline.** If ClickUp cannot be reached, the commit still succeeds and its log is saved to
`~/.config/clickup/queue.json`. The next commit or `cu` command sends it, with the time it was saved.

**Rate limit.** ClickUp allows about 100 requests a minute per token. When it says to slow down, `cu` waits and
retries on its own (up to 30 seconds, with a one-line notice). Inside a git hook it waits at most a few seconds;
after that the commit log is queued like an offline one, so git is never held up.

**Hooks never block git.** Any error inside a hook is printed as one line and the commit or checkout goes through.

**Updates.** Once a day, in a terminal, `cu` checks whether a newer clickup-flow is published on npm and prints one line
if so. The check takes at most 1.5 seconds, never runs in hooks or CI, and can be turned off with
`cu config update_check off`.

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
| Cursor | `.cursor/rules/clickup-flow.mdc` |
| Codex, GitHub Copilot, Windsurf and other `AGENTS.md` readers | `AGENTS.md` (skipped if your repo already tracks one) |

**2. Claude Code plugin.** It adds a `clickup` skill, the MCP tools below, and a session hook that tells Claude which
task is current when a session starts. Run this once inside Claude Code:

```
/plugin install clickup-flow --marketplace twahanur/cu-clickup
```

On older Claude Code versions: `/plugin marketplace add twahanur/cu-clickup`, then `/plugin install clickup-flow@clickup-flow`.

**3. MCP server (Cursor, Claude Desktop, Windsurf, VS Code and any MCP client).** Your agent calls ClickUp tools
directly instead of typing commands. `cu agents` adds it to Cursor for you and prints the config for other clients:

```json
{ "mcpServers": { "clickup-flow": { "command": "npx", "args": ["-y", "clickup-flow", "mcp"] } } }
```

| Tool | Does |
|---|---|
| `clickup_plan_day` | Creates today's tasks in todo, with optional due date and priority |
| `clickup_start_task` | Finds or creates a task, moves it to in progress, makes it current, starts the timer |
| `clickup_comment` | Posts a progress note |
| `clickup_pause_timer` | Stops the timer, keeps the status and the current task |
| `clickup_finish_task` | Posts a summary, moves to in review |
| `clickup_block_task` | Moves to blocked with the reason |
| `clickup_handoff` | Reassigns a task to a teammate with a note |
| `clickup_pr` | Links a pull request, moves to in review |
| `clickup_set_status` | Sets any status |
| `clickup_add_task` / `clickup_report_bug` | Creates a task, subtask or bug. Tasks take an optional due date and priority |
| `clickup_daily_report` | Returns the day's report |
| `clickup_my_tasks` / `clickup_team` / `clickup_show_task` / `clickup_where` | Reads: your tasks, who does what, one task, setup |

Each tool takes an optional `repo_path` for agents that work across several projects.

**What agents do on their own.** They change only your own tasks, tell you in one line what they changed, never mark
a task done until you confirm it is merged and tested, and ask you to run `npx clickup-flow` if a repo is not set up yet.
The token never reaches the agent: the tools run locally with the token on your machine.

## Configuration

Settings are changed with `cu config`. `cu config` alone lists them with their current values, `cu config <name>`
prints one, and `cu config <name> <value>` changes it.

| Setting | Values | Default | Effect |
|---|---|---|---|
| `lang` | `en`, `bn` | `en` | Language of the names and reports `cu` writes: the catch-all task and `cu report` |
| `timer` | `on`, `off` | `on` | Start and stop ClickUp time tracking with `cu start`, `pause`, `finish`, `block`, `handoff` |
| `commit_tag` | `on`, `off` | `on` | Add `CU-<id>` of the current task to commit messages |
| `update_check` | `on`, `off` | `on` | Say once a day when a newer clickup-flow is published |
| `slack_webhook` | a `https://hooks.slack.com/services/...` URL, or `off` | not set | Where `cu report --slack` posts |
| `token_store` | `file`, `keychain` | `file` | Where the token is kept. Changing it moves the token |

Everything lives in `~/.config/clickup/`:

| File | Contents |
|---|---|
| `token` | Your ClickUp API token (mode `600`). Absent when the token is in the keychain |
| `config.json` | Default space, your personal list per space, and your settings |
| `state.json` | Current task and today's catch-all task per space, the local diary for `cu report` (14 days), the last update check |
| `queue.json` | Commit logs waiting to be sent |
| `hooks/` | The git hook scripts used by linked repos |

Each linked repository gets only local git settings (`clickup.space`, `clickup.workspace`, `clickup.spacename`,
`core.hooksPath`) and the git-ignored agent rule files listed above.

| Environment variable | Purpose |
|---|---|
| `CLICKUP_API_TOKEN` | Use this token instead of the saved one |
| `CU_CONFIG_DIR` | Use another folder instead of `~/.config/clickup` |

## Security and privacy

- **Your token stays on your machine.** It is kept either in the system keychain (macOS Keychain, or the Linux
  Secret Service through `secret-tool`) or in `~/.config/clickup/token`. Setup offers the keychain when one is
  available, and `cu config token_store keychain` or `cu config token_store file` moves the token later. The
  config folder is `700` and every file in it is `600`, so other users on the computer cannot read your token,
  tasks or commit messages.
- **The token is never on a command line.** When it goes into or out of the keychain, it is passed to `security`
  or `secret-tool` through standard input, so it does not show up in the process list.
- **The token is only sent to `api.clickup.com`.** No other server ever receives it. The test-only
  `CU_API_BASE` override is refused unless it points to `localhost`, so a hostile environment variable cannot
  redirect the token. The token is never passed on to other programs that `cu` starts, such as `npm` or the browser.
  The Slack webhook receives only the report text, and only when you pass `--slack`.
- **The prompt hides the token.** `cu setup --token pk_...` also works, but the value then stays in your shell
  history. Prefer the prompt.
- **Nothing is committed.** Repos get local git settings and a `CLAUDE.local.md` listed in `.git/info/exclude`. If a
  repo ships `CLAUDE.local.md` as a symlink, `cu` refuses to write through it. The only exception is the workflow
  that `cu github-action` writes when you ask for it. It reads the token from a repository secret, never from your
  machine.
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
| `cu: command not found` | `npm i -g clickup-flow`, and make sure `$(npm prefix -g)/bin` is on your `PATH` |
| `... is not linked to a ClickUp space yet` | Answer **Y** when `cu` offers to set it up, or run `cu setup` |
| `ClickUp did not accept that token` | Copy a fresh token and run `cu setup` again |
| Commits are not logged | Run `cu setup` in the repo, then check `git config core.hooksPath` |
| `could not read the ClickUp token from the system keychain (locked?)` | Unlock the keychain. Commit logs made meanwhile are queued and sent by the next `cu` command. To stop using it: `cu config token_store file` |
| `(timer not started: ...)` | Time tracking may be off in your ClickUp workspace. Run `cu config timer off` |
| `ClickUp rate limit: waiting ...` | Normal under heavy use. `cu` retries by itself |
| `This space has no "blocked" status` | Expected for spaces without that status. See `cu statuses` |
| Tab completion does not work | Add the `cu completion` line for your shell to its startup file, then open a new terminal |

## Uninstall

```bash
cu config token_store file   # first, if the token is in the keychain (or delete the "clickup-flow" keychain item)

# in each linked repo
git config --unset core.hooksPath   # turns off all cu hooks, including prepare-commit-msg
git config --unset clickup.space
git config --unset clickup.workspace
git config --unset clickup.spacename
rm -f CLAUDE.local.md .cursor/rules/clickup-flow.mdc   # or remove only the "clickup-flow" section
# AGENTS.md: remove the section between <!-- clickup-flow:start --> and <!-- clickup-flow:end -->
# .github/workflows/clickup-flow-merged.yml: delete it if you added it with cu github-action

npm uninstall -g clickup-flow
rm -rf ~/.config/clickup
# Cursor: remove "clickup-flow" from ~/.cursor/mcp.json · Claude Code: /plugin uninstall clickup-flow
```

If `cu` is already gone, delete the keychain item yourself: `security delete-generic-password -s clickup-flow -a clickup`
on macOS, or `secret-tool clear service clickup-flow account clickup` on Linux.

## Development

```bash
git clone https://github.com/twahanur/cu-clickup.git
cd cu-clickup
npm test          # unit tests, no network
npm link          # use your working copy as the global `cu`
```

The tests also run on GitHub Actions for every push to `main` and every pull request (the Tests badge above).

The code is a single module, [`lib/cu.js`](lib/cu.js), with no dependencies.
Issues and pull requests are welcome.

## License

[MIT](LICENSE) © Twahanur Rahman
