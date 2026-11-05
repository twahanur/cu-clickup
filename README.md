<div align="center">

# cu

**ClickUp from your terminal and git.**

Plan the day, start and finish tasks, and log every commit on the task you are working on,
without leaving the terminal and without defining tasks in advance.

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
- **Works with AI coding agents.** `cu setup` writes rules for [Claude Code](https://claude.com/claude-code) so
  the agent keeps ClickUp in sync while it works.

## Features

- Daily flow in four commands: `today`, `start`, `finish`, `block`
- Automatic commit logging through git hooks that never block a commit
- One ClickUp space per repo, so several projects can run side by side
- Status names matched to each space (`to do`, `complete`, and so on)
- Offline queue: commit logs made without a network are sent later
- A single catch-all task per day for commits made without a current task, so tiny tasks do not pile up
- Nothing is written to your repository's tracked files
- Zero runtime dependencies. Needs Node 18.17 or later and git.

## Installation

```bash
npm install -g github:twahanur/cu-clickup
```

Check it:

```bash
cu version
```

## Quick start

**1. Get a ClickUp API token.**
In ClickUp, open your avatar → **Settings** → **Apps** → **API Token** → **Generate**. It starts with `pk_`.

**2. Link a repository.**

```bash
cd path/to/your-repo
cu setup
```

`cu setup` will:

1. ask for your token the first time and store it in `~/.config/clickup/token` (mode `600`)
2. list your ClickUp spaces and ask which one this repo belongs to
3. create your personal list **👤 Your Name** in that space, where your new tasks go
4. turn on the git hooks for this repo
5. write a git-ignored `CLAUDE.local.md` with the workflow rules for Claude Code

Run `cu setup` once in every repository you work in. Each repo can point to a different space.

**3. Work as usual.**

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
| `cu setup [--space <name>] [--token pk_...]` | Links the repo, switches its space, or replaces the token |
| `cu add "<title>" [--list L] [--parent REF] [--desc D]` | Creates one task in **todo**, or a subtask with `--parent` |
| `cu status <ref> <status>` | Sets any status of the space |
| `cu pr [<ref>] <url>` | Fills a PR link field if the list has one, then moves to **in review** |
| `cu bug "<title>" ["<details>"]` | Creates a bug in the space's bug list, or in your own list |
| `cu tasks [file]` | Writes all your tasks in the space as a Markdown checklist |
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

**Branches.** A new branch whose name contains `CU-<id>`, for example `feat/CU-86ex1abcd-login`, starts that
task when you check it out.

**Offline.** If ClickUp cannot be reached, the commit still succeeds and its log is saved to
`~/.config/clickup/queue.json`. The next commit or `cu` command sends it, with the time it was saved.

**Hooks never block git.** Any error inside a hook is printed as one line and the commit or checkout goes through.

## Using with Claude Code

`cu setup` adds a section to `CLAUDE.local.md` in the repo root. Claude Code loads this file automatically, and the
section tells the agent to:

- turn the list of work you give at the start of the day into tasks with `cu today`
- run `cu start` before working on something, and `cu finish` when it is done
- post progress with `cu comment`, and answer "who is working on what" with `cu team`

The file is added to `.git/info/exclude`, so it is never committed. Running `cu setup` again refreshes the section
and leaves the rest of the file alone.

## Configuration

Everything lives in `~/.config/clickup/`:

| File | Contents |
|---|---|
| `token` | Your ClickUp API token (mode `600`) |
| `config.json` | Default space and your personal list per space |
| `state.json` | Current task and today's catch-all task per space |
| `queue.json` | Commit logs waiting to be sent |
| `hooks/` | The git hook scripts used by linked repos |

Each linked repository gets only local git settings: `clickup.space`, `clickup.workspace` and `core.hooksPath`.

| Environment variable | Purpose |
|---|---|
| `CLICKUP_API_TOKEN` | Use this token instead of the saved one |
| `CU_CONFIG_DIR` | Use another folder instead of `~/.config/clickup` |

## Security and privacy

- The token is stored only on your machine, readable only by you, and sent only to `api.clickup.com`.
- Nothing is written to tracked files in your repositories.
- Tasks are created and assigned only to you. `cu` changes another person's task only when you pass that task's
  reference yourself.
- Comments are posted with `notify_all: false`, so commit logs do not notify the whole team.

## Troubleshooting

| Problem | Fix |
|---|---|
| `cu: command not found` | Make sure npm's global bin folder is on your `PATH` (`npm prefix -g`) |
| `This repo is not linked to a ClickUp space yet` | Run `cu setup` in that repo |
| `Token rejected by ClickUp` | `cu setup --token pk_...` with a fresh token |
| Commits are not logged | Run `cu setup` in the repo, then check `git config core.hooksPath` |
| `This space has no "blocked" status` | Expected for spaces without that status. See `cu statuses` |

## Uninstall

```bash
# in each linked repo
git config --unset core.hooksPath
git config --unset clickup.space
git config --unset clickup.workspace
rm CLAUDE.local.md          # or remove only the "clickup" section

npm uninstall -g @twahanur/cu
rm -rf ~/.config/clickup
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
