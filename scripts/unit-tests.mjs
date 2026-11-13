import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const project = resolve(import.meta.dirname, "..");
const tests = (await readdir(join(project, "tests"))).filter(file => file.endsWith(".test.mjs")).sort().map(file => "tests/" + file);
const child = spawn(process.execPath, ["--test", "--test-reporter=tap", ...tests], { cwd: project });
let output = "";
child.stdout.on("data", chunk => { output += chunk; process.stdout.write(chunk); });
child.stderr.on("data", chunk => { output += chunk; process.stderr.write(chunk); });
const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
const count = key => Number(output.match(new RegExp("^# " + key + " (\\d+)$", "m"))?.[1] || 0);
const sources = {};
for (const file of [...tests, "scripts/unit-tests.mjs", "src/lib/amounts.mjs", "src/lib/market.mjs", "src/lib/chain.mjs", "scripts/lib/release.mjs", "scripts/lib/trade-proof.mjs"]) sources[file] = createHash("sha256").update(await readFile(join(project, file))).digest("hex");
const status = code === 0 && count("tests") > 0 && count("tests") === count("pass") ? "PASS" : "FAIL";
await mkdir(join(project, "docs/evidence"), { recursive: true });
await writeFile(join(project, "docs/evidence/unit-tests.json"), JSON.stringify({ status, executedAt: new Date().toISOString(), tests: count("tests"), passed: count("pass"), failed: count("fail"), exitCode: code, sources }, null, 2) + "\n");
if (status !== "PASS") process.exit(code || 1);
