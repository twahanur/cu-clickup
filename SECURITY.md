# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through
[GitHub security advisories](https://github.com/twahanur/cu-clickup/security/advisories/new).

Include what you found, how to reproduce it, and which version you used (`cu version`).
You will get an answer within a few days, and a fix is released as soon as possible.

## Supported versions

Only the latest published version receives security fixes. Update with `npm i -g cusync@latest`.

## Scope

`cu` handles a ClickUp API token and writes git hooks, so the following are in scope:

- the token being exposed: written with loose permissions, logged, sent to another host, or passed to child processes
- writing outside `~/.config/clickup/` or the repository being set up
- shell injection through hook scripts, branch names, commit messages or task names
- changing ClickUp data the user did not ask to change
