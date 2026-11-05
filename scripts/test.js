// Runs every test/*.test.js on any OS (no shell globbing, which Windows and Node 18/20 lack).
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const files = fs.readdirSync("test").filter((f) => f.endsWith(".test.js")).map((f) => `test/${f}`);
try {
  execFileSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
} catch {
  process.exit(1);
}
