import { resolve } from "node:path";
import { readReleasePlan, createRPC, verifyRelease, saveJSON } from "./lib/release.mjs";

const [planPath, output] = process.argv.slice(2);
if (!planPath) throw new Error("Usage: npm run release:verify -- PLAN.json [OUTPUT.json]. This command only reads the network.");
const plan = await readReleasePlan(resolve(planPath));
const result = await verifyRelease(plan, createRPC(plan.rpc));
if (output) await saveJSON(resolve(output), result);
console.log(JSON.stringify(result, null, 2));
