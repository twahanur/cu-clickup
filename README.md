# cu: ClickUp from your terminal and git

Keep ClickUp up to date while you code, without defining tasks in advance:
plan the day, start and finish tasks, and every commit is logged on the task you are working on.
Each repo can belong to a different ClickUp space. Works on its own or with [Claude Code](https://claude.com/claude-code).

```bash
npm install -g @SCOPE/cu
cd your-repo
cu setup
```

`cu setup` asks for your ClickUp API token (ClickUp → avatar → Settings → Apps → API Token) the first time,
then which space this repo belongs to. It creates your own list **👤 Your Name** in that space (new tasks go
there, so the space shows who is working on what), turns on the git hooks for the repo, and writes a git-ignored
`CLAUDE.local.md` so Claude Code keeps ClickUp in sync for you. Run it once in every repo.

## Daily flow

| Command | What happens in ClickUp |
|---|---|
| `cu today "Task A" "Task B"` | each title becomes a task in **todo** |
| `cu start "Task A"` | **in progress**, and it becomes your current task (created if nothing matches) |
| `git commit ...` | the commit is logged as a comment on the current task |
| `cu comment "what happened"` | comment on the current task |
| `cu finish "summary"` | summary comment, **in review** |
| `cu block "waiting for X"` | **blocked**, with a comment |
| `cu team` | who is working on what in this space right now |

More: `cu mine`, `cu current`, `cu show <ref>`, `cu where`, `cu lists`, `cu statuses`, `cu status <ref> <status>`,
`cu pr <url>`, `cu bug "title"`, `cu tasks`, `cu add "title" --parent <ref>`. Run `cu` for the full list.

A task `<ref>` is a ClickUp id (`86ex1abcd`, or `CU-86ex1abcd` in a commit message), part of the task name, or
`.` for the current task.

## Details

- **Statuses** are read from the space, and `todo`, `in progress`, `in review`, `blocked` and `done` are matched to
  the space's own names (for example `to do` and `complete`). If a space has no such status, the status stays as it
  is and only the comment is added.
- **Commits without a current task** go to one catch-all task per day ("🗒 Name: অন্যান্য কাজ YYYY-MM-DD"), so no
  pile of tiny tasks appears. A commit message with `CU-<id>` goes to that task.
- **Offline**: commit logs are queued in `~/.config/clickup/queue.json` and sent by the next commit or `cu` command.
- **Hooks never block git**: if ClickUp fails, the commit still goes through.
- **Private by design**: your token (`~/.config/clickup/token`, mode 600), config and state stay in
  `~/.config/clickup/`. Repos only get two local git config keys (`clickup.space`, `clickup.workspace`), a local
  `core.hooksPath`, and a `CLAUDE.local.md` listed in `.git/info/exclude`. Nothing is committed.
- `CLICKUP_API_TOKEN` overrides the saved token, and `CU_CONFIG_DIR` moves the config folder.

Requires Node 18.17+ and git. MIT licensed.
