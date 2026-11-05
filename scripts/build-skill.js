// Regenerates skills/clickup/SKILL.md from the rules in lib/cu.js, so every agent gets the same instructions.
import fs from "node:fs";
import { agentRules } from "../lib/cu.js";

export const skill = `---
name: clickup
description: Keep ClickUp in sync while coding with clickup-flow. Use when the user says what they will work on (today's plan), before starting or after finishing a piece of work, when a PR is opened, when work is blocked, or when they ask who is working on what. Applies in repos linked with clickup-flow.
---

${agentRules("")}`;

if (process.argv[1] && process.argv[1].endsWith("build-skill.js")) {
  fs.writeFileSync(new URL("../skills/clickup/SKILL.md", import.meta.url), skill);
  console.log("skills/clickup/SKILL.md written");
}
