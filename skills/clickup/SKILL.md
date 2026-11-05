---
name: clickup
description: Keep ClickUp in sync while coding with cusync. Use when the user says what they will work on (today's plan), before starting or after finishing a piece of work, when a PR is opened, when work is blocked, or when they ask who is working on what. Applies in repos linked with cusync.
---

## ClickUp: keep it in sync without being asked

Work in this repo is tracked in ClickUp with **cusync**. Keep ClickUp up to
date on your own while you work, for the developer you work with. Prefer the `clickup_*` MCP tools when you
have them; otherwise run the `cu` command in the terminal (`cu` alone prints usage). The token and config live in
`~/.config/clickup/`: never print the token and never copy that folder or this section into tracked files.

A task is referenced by its ClickUp id (`86ex1abcd`, or `CU-86ex1abcd` in a commit message), by part of its
name, or `.` for the current task.

| When | MCP tool | Terminal |
|---|---|---|
| The user lists the day's work ("today I'll do X and Y", "আজ এই এই কাজ করব") | `clickup_my_tasks` first, then `clickup_plan_day` | `cu mine`, then `cu today "X" "Y"` |
| Before you start a piece of work | `clickup_start_task` | `cu start "<task or new title>"` |
| A decision, a partial result, end of day | `clickup_comment` | `cu comment "<done, left, blocking>"` |
| The work is finished and tests pass | `clickup_finish_task` with a short summary | `cu finish "<summary>"` |
| A pull request is opened | `clickup_pr` | `cu pr <url>` |
| Waiting on someone or something | `clickup_block_task` | `cu block "<what you wait for>"` |
| "Who is working on what?" ("কে কী করছে") | `clickup_team` | `cu team` |

Rules:
1. Do these yourself, without asking first, and tell the user in one short line what you changed in ClickUp.
2. `start` finds a matching task or creates one, so start the real task before writing code. Commits are logged by
   a git hook on the current task; with no current task they go to a catch-all task for the day.
3. Write summaries and comments for the teammate who reads them: what changed, what is left, what blocks.
4. Never mark a task done unless the user confirms it is merged and tested. Never change another person's task.
5. If cusync says the repo is not set up, ask the user to run `npx cusync` in a terminal in this folder (it is
   interactive), then carry on. If ClickUp is unreachable, say so in one line and carry on with the code; never
   retry in a loop.
