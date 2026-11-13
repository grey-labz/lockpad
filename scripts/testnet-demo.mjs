import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readReleasePlan, createRPC, saveJSON } from "./lib/release.mjs";
import { verifyTrade } from "./lib/trade-proof.mjs";

const [planPath, proofPath, output] = process.argv.slice(2);
if (!planPath || !proofPath) throw new Error("Usage: npm run release:trade -- PLAN.json TRADE-PROOF.json [OUTPUT.json]. This verifies five receipts from a completed seller → buyer → original-maturity claim; it does not sign or repeat the trade.");
const plan = await readReleasePlan(resolve(planPath));
const proof = JSON.parse(await readFile(resolve(proofPath), "utf8"));
const result = await verifyTrade(plan, proof, createRPC(plan.rpc));
if (output) await saveJSON(resolve(output), result);
console.log(JSON.stringify(result, null, 2));
