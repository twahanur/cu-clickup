# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through
[GitHub security advisories](https://github.com/twahanur/cu-clickup/security/advisories/new).

Include what you found, how to reproduce it, and which version you used (`cu version`).
You will get an answer within a few days, and a fix is released as soon as possible.

## Supported versions

Only the latest published version receives security fixes. Update with `npm i -g clickup-flow@latest`.

## Verifying a release

From 1.3.2 on, each version is published by GitHub Actions with npm provenance, which links it to the commit and workflow that built it. To check an installed copy, run `npm audit signatures` in the project that depends on it.

## Network access

`cu` has no dependencies and talks only to these hosts:

- `api.clickup.com`: your ClickUp data, using your token
- `registry.npmjs.org`: the daily update check, turned off with `update_check off`
- `hooks.slack.com`: only the Slack webhook you configure
- `api.github.com`: only in the merged-PR GitHub Action, if you install it

## Scope

`cu` handles a ClickUp API token and writes git hooks, so the following are in scope:

- the token being exposed: written with loose permissions, logged, sent to another host, or passed to child processes
- writing outside `~/.config/clickup/` or the repository being set up
- shell injection through hook scripts, branch names, commit messages or task names
- changing ClickUp data the user did not ask to change
