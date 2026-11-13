import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "vite";
import { createReleasePlan, createRPC, verifyRelease, project } from "./lib/release.mjs";

if (process.env.VITE_NETWORK && process.env.VITE_NETWORK !== "testnet") throw new Error("The published Lockpad build supports testnet only.");
const plan = await createReleasePlan({ accounts: { token: process.env.VITE_TOKEN_ACCOUNT, vault: process.env.VITE_VAULT_ACCOUNT, market: process.env.VITE_MARKET_ACCOUNT }, rpc: process.env.VITE_NEAR_RPC || "https://test.rpc.fastnear.com" });
const verification = await verifyRelease(plan, createRPC(plan.rpc));
Object.assign(process.env, plan.frontend, { VITE_DEMO: "0" });
await build({ root: project });
await writeFile(join(project, "dist/release.json"), JSON.stringify(verification, null, 2) + "\n");
console.log("PASS: the published app configuration matches all three deployed contracts; proof is included at release.json.");
