#!/usr/bin/env node
import { main } from "../lib/cu.js";

process.exitCode = await main(process.argv.slice(2));
