import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { KeyPair } from "near-api-js";
import { createRPC, DEFAULT_RPC, project } from "./lib/release.mjs";

const args = process.argv.slice(2), accountId = args.find(arg => !arg.startsWith("--"));
if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*\.testnet$/.test(accountId || "") || accountId.length > 64) throw new Error("Pass a fresh top-level .testnet account ID. Add --execute only after the account creation is approved.");
if (!args.includes("--execute")) {
  console.log(`Plan only: create ${accountId} through the public testnet faucet and store its key in LOCKPAD_TESTNET_KEYS outside the repository. No account or key was created.`);
  process.exit(0);
}
const directory = process.env.LOCKPAD_TESTNET_KEYS;
if (!directory) throw new Error("Set LOCKPAD_TESTNET_KEYS to a private directory outside the repository.");
const root = await realpath(project), candidate = resolve(directory);
if (candidate === root || candidate.startsWith(root + sep)) throw new Error("Deployment credentials must stay outside the repository.");
await mkdir(candidate, { recursive: true, mode: 0o700 });
const location = await realpath(candidate);
if (location === root || location.startsWith(root + sep)) throw new Error("The credential directory resolves inside the repository.");
const client = createRPC(DEFAULT_RPC);
if ((await client.head()).status.chain_id !== "testnet") throw new Error("The account faucet workflow requires a verified testnet RPC.");
const path = join(location, accountId + ".json");
let pair;
try {
  const credential = JSON.parse(await readFile(path, "utf8"));
  if (credential.account_id !== accountId) throw new Error("The retained credential belongs to another account.");
  pair = KeyPair.fromString(credential.private_key);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  if (await client.account(accountId)) throw new Error("The requested account already exists; no credential will be generated for it.");
  pair = KeyPair.fromRandom("ed25519");
  await writeFile(path, JSON.stringify({ account_id: accountId, public_key: pair.getPublicKey().toString(), private_key: pair.toString() }) + "\n", { mode: 0o600, flag: "wx" });
}
const publicKey = pair.getPublicKey().toString();
if (!await client.account(accountId)) {
  const response = await fetch("https://helper.testnet.near.org/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Testnet faucet returned HTTP ${response.status}. The same local key is retained for inspection and retry.`);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await client.account(accountId)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
const key = await client.query({ request_type: "view_access_key", account_id: accountId, public_key: publicKey });
if (key.permission !== "FullAccess") throw new Error("The created account does not have the expected deployment key.");
console.log(`Verified testnet account ${accountId}; its private key was retained outside the repository.`);
