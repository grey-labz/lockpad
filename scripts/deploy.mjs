import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createReleasePlan, readReleasePlan, saveJSON, createRPC, inspectTargets, loadDeploymentKeys, createSigner, deployRelease, project, DEFAULT_RPC } from "./lib/release.mjs";

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const execute = args.includes("--execute");

if (args.includes("--help")) {
  console.log("Prepare only: npm run release:plan -- TOKEN.testnet VAULT.testnet MARKET.testnet [--rpc URL]\nInspect only: npm run release:preflight -- --plan PATH\nDeploy an approved plan: npm run release:deploy -- --plan PATH --execute\nSet LOCKPAD_TESTNET_KEYS to an external private directory containing the three funded account credentials.");
  process.exit(0);
}

const planPath = option("--plan");
let plan;
if (planPath) plan = await readReleasePlan(resolve(planPath));
else {
  if (execute || args.includes("--preflight")) throw new Error("Execution and preflight require an existing reviewed --plan PATH.");
  const [token, vault, market] = args.filter((arg, index) => !arg.startsWith("--") && (index === 0 || !["--rpc", "--out"].includes(args[index - 1])));
  plan = await createReleasePlan({ accounts: { token, vault, market }, rpc: option("--rpc") || DEFAULT_RPC });
  const directory = resolve(option("--out") || join(project, ".release", plan.id.slice(0, 12)));
  await saveJSON(join(directory, "plan.json"), plan);
  console.log(JSON.stringify(plan, null, 2));
  console.log(`Prepared ${join(directory, "plan.json")}. No account creation, signing or network transaction occurred.`);
  process.exit(0);
}

const client = createRPC(plan.rpc);
if (!execute) {
  if (args.includes("--preflight")) {
    const preflight = await inspectTargets(plan, client);
    await saveJSON(join(resolve(planPath, ".."), "preflight.json"), preflight);
    console.log(JSON.stringify(preflight, null, 2));
  } else console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

const pairs = await loadDeploymentKeys(process.env.LOCKPAD_TESTNET_KEYS, plan.accounts);
const signer = await createSigner(plan, client, pairs);
const directory = resolve(planPath, "..");
const journalPath = join(directory, "deployment-journal.json");
let journal;
try { journal = JSON.parse(await readFile(journalPath, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; journal = { schema: "lockpad-deployment-journal-v1", releaseId: plan.id, network: plan.network, createdAt: new Date().toISOString(), steps: {} }; }
const verification = await deployRelease(plan, client, signer, journal, value => saveJSON(journalPath, value));
await saveJSON(join(directory, "verification.json"), verification);
console.log(`PASS: all three deployed hashes, initializers and both token registrations match the release plan. Read-only verification: ${join(directory, "verification.json")}`);
