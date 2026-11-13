import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { connect, KeyPair, keyStores, transactions, utils } from "near-api-js";

export const project = resolve(import.meta.dirname, "../..");
export const DEFAULT_RPC = "https://test.rpc.fastnear.com";
export const EMPTY_CODE = "11111111111111111111111111111111";
const GAS = "100000000000000";
const STORAGE_CAP = "30000000000000000000000";
const SOURCE_FILES = ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", ".cargo/config.toml", "contract/Cargo.toml", "contract/src/lib.rs", "marketplace/Cargo.toml", "marketplace/src/lib.rs", "token/Cargo.toml", "token/src/lib.rs"];
const FILES = { token: "lockpad_test_token.wasm", vault: "lockpad_reference_vault.wasm", market: "lockpad_marketplace.wasm" };
export const sha256 = value => createHash("sha256").update(value).digest("hex");
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const bodyOf = ({ id, createdAt, ...body }) => body;

export function validateAccounts(accounts, network = "testnet") {
  if (!["testnet", "sandbox"].includes(network)) throw new Error("Only testnet and local Sandbox releases are supported.");
  const ids = [accounts.token, accounts.vault, accounts.market];
  const pattern = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
  if (ids.some(id => typeof id !== "string" || id.length < 2 || id.length > 64 || !pattern.test(id) || !(network === "testnet" ? id.endsWith(".testnet") : id.endsWith(".test.near"))) || new Set(ids).size !== 3) {
    throw new Error("Provide three distinct valid contract accounts for the selected network: token, vault, market.");
  }
}

export function validateRPC(rpc, network) {
  const url = new URL(rpc);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (network === "testnet" ? url.protocol !== "https:" || local : !local || url.protocol !== "http:")) {
    throw new Error("Use a public HTTPS testnet RPC, or a loopback HTTP RPC for a local Sandbox. Credentials do not belong in a release plan.");
  }
}

export async function createReleasePlan({ accounts, network = "testnet", rpc = DEFAULT_RPC }, directory = project) {
  validateAccounts(accounts, network);
  validateRPC(rpc, network);
  const manifest = JSON.parse(await readFile(join(directory, "docs/evidence/contract-build.json"), "utf8"));
  for (const file of SOURCE_FILES) {
    if (sha256(await readFile(join(directory, file))) !== manifest.sources?.[file]) throw new Error(`Contract source changed: ${file}. Run npm run contracts:build.`);
  }
  const contracts = [];
  for (const [role, file] of Object.entries(FILES)) {
    const bytes = await readFile(join(directory, "res", file));
    const expected = manifest.contracts?.[file];
    if (!expected || expected.sha256 !== sha256(bytes) || expected.bytes !== bytes.length) throw new Error(`Contract artifact mismatch: ${file}. Run npm run contracts:build.`);
    contracts.push({ role, accountId: accounts[role], file, bytes: bytes.length, sha256: expected.sha256,
      codeHash: utils.serialize.base_encode(createHash("sha256").update(bytes).digest()),
      initializer: role === "token" ? {} : role === "vault" ? { asset_id: accounts.token } : { asset_id: accounts.token, source_ids: [accounts.vault] },
      gas: GAS, depositYocto: "0", minimumFreshBalanceYocto: (BigInt(bytes.length) * 10n ** 19n + 10n ** 24n).toString(),
    });
  }
  const body = {
    schema: "lockpad-release-v1", network, rpc, accounts: { token: accounts.token, vault: accounts.vault, market: accounts.market }, contracts,
    registrations: [accounts.vault, accounts.market].map(accountId => ({ signerId: accountId, receiverId: accounts.token, methodName: "storage_deposit", args: { account_id: accountId, registration_only: true }, maximumDepositYocto: STORAGE_CAP, gas: GAS })),
    frontend: { VITE_NETWORK: "testnet", VITE_TOKEN_ACCOUNT: accounts.token, VITE_VAULT_ACCOUNT: accounts.vault, VITE_MARKET_ACCOUNT: accounts.market, VITE_NEAR_RPC: rpc },
    balanceEstimate: "Wasm bytes at 0.00001 NEAR/byte plus 1 test NEAR per account for state, registration and gas. This is a funding reserve, not a fixed fee.",
    limitations: ["Reference source only", "Zero-value test token", "Retained upgrade keys", "Unaudited contracts", "Withdrawal/redemption callback recovery limits"],
  };
  return { ...body, id: sha256(canonical(body)), createdAt: new Date().toISOString() };
}

export async function readReleasePlan(path, directory = project) {
  const saved = JSON.parse(await readFile(path, "utf8"));
  const expected = await createReleasePlan(saved, directory);
  if (saved.id !== expected.id || canonical(bodyOf(saved)) !== canonical(bodyOf(expected))) throw new Error("The release plan differs from the current reviewed contracts or configuration. Prepare a new plan.");
  return saved;
}

export async function saveJSON(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

export function createRPC(rpc) {
  const request = async (method, params) => {
    const response = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "lockpad-release", method, params }), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`NEAR RPC returned HTTP ${response.status}.`);
    const payload = await response.json();
    if (payload.error) {
      const error = new Error(payload.error.cause?.info?.error_message || payload.error.message || "NEAR RPC rejected the request.");
      error.rpcError = payload.error;
      throw error;
    }
    if (!("result" in payload)) throw new Error("NEAR RPC returned no result.");
    return payload.result;
  };
  const query = (params, block) => request("query", { ...params, ...(block ? { block_id: block } : { finality: "final" }) });
  return {
    request, query,
    head: async () => ({ status: await request("status", []), block: await request("block", { finality: "final" }) }),
    account: async (accountId, block) => {
      try { return await query({ request_type: "view_account", account_id: accountId }, block); }
      catch (error) { if (["UNKNOWN_ACCOUNT", "AccountDoesNotExist"].includes(error.rpcError?.cause?.name) || error.rpcError?.data?.includes?.("does not exist")) return null; throw error; }
    },
    view: async (accountId, methodName, args = {}, block) => {
      const value = await query({ request_type: "call_function", account_id: accountId, method_name: methodName, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") }, block);
      return JSON.parse(Buffer.from(value.result).toString("utf8"));
    },
    receipt: (hash, signerId) => request("tx", { tx_hash: hash, sender_account_id: signerId, wait_until: "FINAL" }),
    broadcast: signed => request("send_tx", { signed_tx_base64: Buffer.from(transactions.encodeTransaction(signed)).toString("base64"), wait_until: "FINAL" }),
  };
}

function assertNetwork(plan, head) {
  const sandboxChain = ["localnet", "sandbox"].includes(head.status.chain_id) || /^test-chain-[a-zA-Z\d_-]+$/.test(head.status.chain_id);
  if (plan.network === "testnet" ? head.status.chain_id !== "testnet" : !sandboxChain) throw new Error(`The RPC reports ${head.status.chain_id}; this plan is for ${plan.network}. No transaction will be signed.`);
}

export async function inspectTargets(plan, client) {
  const head = await client.head();
  assertNetwork(plan, head);
  const targets = await Promise.all(plan.contracts.map(async contract => {
    const state = await client.account(contract.accountId, head.block.header.hash);
    return { role: contract.role, accountId: contract.accountId, state, expectedCodeHash: contract.codeHash, minimumFreshBalanceYocto: contract.minimumFreshBalanceYocto,
      status: !state ? "missing" : state.code_hash === EMPTY_CODE ? "fresh" : state.code_hash === contract.codeHash ? "matching" : "different code" };
  }));
  return { network: plan.network, inspectedAt: new Date().toISOString(), block: { hash: head.block.header.hash, height: head.block.header.height, timestamp: head.block.header.timestamp_nanosec || head.block.header.timestamp }, targets };
}

export async function verifyRelease(plan, client) {
  const head = await client.head();
  assertNetwork(plan, head);
  const block = head.block.header.hash;
  const contracts = await Promise.all(plan.contracts.map(async expected => {
    const state = await client.account(expected.accountId, block);
    if (state?.code_hash !== expected.codeHash) throw new Error(`Deployed code does not match the reviewed Wasm: ${expected.accountId}.`);
    return { role: expected.role, accountId: expected.accountId, codeHash: state.code_hash, sha256: expected.sha256, storageUsage: state.storage_usage };
  }));
  const { token, vault, market } = plan.accounts;
  const [metadata, source, config, bounds, vaultStorage, marketStorage] = await Promise.all([
    client.view(token, "ft_metadata", {}, block), client.view(vault, "get_config", {}, block), client.view(market, "get_config", {}, block),
    client.view(token, "storage_balance_bounds", {}, block), client.view(token, "storage_balance_of", { account_id: vault }, block), client.view(token, "storage_balance_of", { account_id: market }, block),
  ]);
  assert.equal(metadata.decimals, 6, "Unexpected token precision");
  assert.equal(metadata.symbol, "TUSD", "Unexpected token symbol");
  assert.equal(source.version, "lockpad-reference-v1", "Unexpected source adapter");
  assert.equal(source.asset_id, token, "Source token does not match");
  assert.equal(config.version, "lockpad-market-v1", "Unexpected marketplace version");
  assert.equal(config.asset_id, token, "Marketplace token does not match");
  assert.deepEqual(config.source_ids, [vault], "Marketplace source allowlist does not match");
  assert.ok(BigInt(bounds.min) > 0n && BigInt(bounds.min) <= BigInt(STORAGE_CAP), "Token registration exceeds the approved cap");
  for (const storage of [vaultStorage, marketStorage]) assert.ok(storage && BigInt(storage.total) >= BigInt(bounds.min), "A contract is not registered with the token");
  return { schema: "lockpad-deployment-verification-v1", status: "PASS", releaseId: plan.id, network: plan.network, verifiedAt: new Date().toISOString(), block: { hash: block, height: head.block.header.height, timestamp: head.block.header.timestamp_nanosec || head.block.header.timestamp }, contracts, accounts: plan.accounts, tokenMetadata: metadata, sourceConfig: source, marketConfig: config, registrations: { vault: vaultStorage, market: marketStorage }, frontend: plan.frontend };
}

export function assertFinalReceipt(outcome, step) {
  if (outcome?.transaction?.hash !== step.hash || outcome.transaction.signer_id !== step.signerId || outcome.transaction.receiver_id !== step.receiverId) throw new Error("The receipt does not match the recorded transaction.");
  if (!outcome.status || !("SuccessValue" in outcome.status) || outcome.receipts_outcome?.some(item => item.outcome.status?.Failure)) throw new Error(`Transaction ${step.hash} is failed or incomplete. No later action will be signed.`);
}

export async function createSigner(plan, client, pairs) {
  const store = new keyStores.InMemoryKeyStore();
  for (const [id, pair] of pairs) await store.setKey(plan.network, id, pair);
  const near = await connect({ networkId: plan.network, nodeUrl: plan.rpc, keyStore: store });
  const access = async (accountId, block) => {
    const pair = pairs.get(accountId);
    if (!pair) throw new Error(`No deployment key is loaded for ${accountId}.`);
    const publicKey = pair.getPublicKey().toString();
    const key = await client.query({ request_type: "view_access_key", account_id: accountId, public_key: publicKey }, block);
    if (key.permission !== "FullAccess") throw new Error(`A full-access deployment key is required for ${accountId}.`);
    return key;
  };
  return {
    check: async (ids, block) => { for (const id of ids) await access(id, block); },
    prepare: async (signerId, receiverId, actions) => {
      const head = await client.head();
      assertNetwork(plan, head);
      const key = await access(signerId, head.block.header.hash);
      const [hash, signed] = await transactions.signTransaction(receiverId, BigInt(key.nonce) + 1n, actions, utils.serialize.base_decode(head.block.header.hash), near.connection.signer, signerId, plan.network);
      return { hash: utils.serialize.base_encode(hash), signed, nonce: signed.transaction.nonce.toString() };
    },
  };
}

export async function loadDeploymentKeys(directory, accounts) {
  if (!directory) throw new Error("Set LOCKPAD_TESTNET_KEYS to a private directory outside the repository.");
  const root = await realpath(project), location = await realpath(directory);
  if (location === root || location.startsWith(root + sep)) throw new Error("Deployment keys must be stored outside the repository.");
  const pairs = new Map();
  for (const id of Object.values(accounts)) {
    const path = await realpath(join(location, id + ".json"));
    if (!path.startsWith(location + sep)) throw new Error("A deployment credential resolves outside its private directory.");
    const credential = JSON.parse(await readFile(path, "utf8"));
    const pair = KeyPair.fromString(credential.private_key);
    if (credential.account_id !== id || credential.public_key && credential.public_key !== pair.getPublicKey().toString()) throw new Error(`Deployment credential does not match ${id}.`);
    pairs.set(id, pair);
  }
  return pairs;
}

export async function deployRelease(plan, client, signer, journal, persist, directory = project) {
  if (journal.releaseId !== plan.id) throw new Error("The deployment journal belongs to another release.");
  const specifications = [...plan.contracts.map(contract => ({ id: "deploy:" + contract.role, signerId: contract.accountId, receiverId: contract.accountId, contract })), ...plan.registrations.map(registration => ({ id: "register:" + registration.signerId, ...registration }))];
  for (const [id, step] of Object.entries(journal.steps)) {
    const expected = specifications.find(specification => specification.id === id);
    if (!expected || step.signerId !== expected.signerId || step.receiverId !== expected.receiverId) throw new Error("The journal contains a transaction outside this release plan.");
    if (!step.hash) continue;
    let outcome;
    try { outcome = await client.receipt(step.hash, step.signerId); }
    catch { throw new Error(`Confirmation is unavailable for ${step.hash}. Inspect that exact receipt before continuing; it will not be signed again.`); }
    assertFinalReceipt(outcome, step);
    step.status = "confirmed"; step.receipt = outcome;
    await persist(journal);
  }
  const inspected = await inspectTargets(plan, client);
  for (const target of inspected.targets) {
    if (!target.state) throw new Error(`Create and fund the fresh testnet account ${target.accountId} before deploying.`);
    if (target.status === "different code" || target.status === "matching" && !journal.steps["deploy:" + target.role]?.hash) throw new Error(`${target.accountId} already has code outside this deployment journal. Use fresh accounts; existing contracts will not be overwritten.`);
    if (target.status === "fresh" && BigInt(target.state.amount) - BigInt(target.state.locked) < BigInt(target.minimumFreshBalanceYocto)) throw new Error(`${target.accountId} needs more test NEAR for its Wasm storage and deployment reserve.`);
  }
  await signer.check(Object.values(plan.accounts), inspected.block.hash);
  for (const specification of specifications) {
    if (journal.steps[specification.id]?.status === "confirmed") continue;
    let actions, depositYocto = "0";
    if (specification.contract) {
      const contract = specification.contract;
      const binary = await readFile(join(directory, "res", contract.file));
      if (sha256(binary) !== contract.sha256) throw new Error("The reviewed Wasm changed before signing.");
      actions = [transactions.deployContract(binary), transactions.functionCall("new", contract.initializer, BigInt(contract.gas), 0n)];
    } else {
      const bounds = await client.view(plan.accounts.token, "storage_balance_bounds");
      depositYocto = bounds.min;
      if (BigInt(depositYocto) <= 0n || BigInt(depositYocto) > BigInt(specification.maximumDepositYocto)) throw new Error("Token storage registration exceeds the approved cap.");
      actions = [transactions.functionCall(specification.methodName, specification.args, BigInt(specification.gas), BigInt(depositYocto))];
    }
    const prepared = await signer.prepare(specification.signerId, specification.receiverId, actions);
    const step = { signerId: specification.signerId, receiverId: specification.receiverId, hash: prepared.hash, nonce: prepared.nonce, depositYocto, status: "prepared", preparedAt: new Date().toISOString() };
    journal.steps[specification.id] = step;
    await persist(journal);
    let outcome;
    try { outcome = await client.broadcast(prepared.signed); }
    catch {
      step.status = "unconfirmed"; await persist(journal);
      throw new Error(`Transaction ${step.hash} was prepared, but its confirmation is unavailable. Resume by checking that exact receipt; no new signature or automatic replay will be made.`);
    }
    step.receipt = outcome;
    try { assertFinalReceipt(outcome, step); }
    catch (error) { step.status = "failed"; await persist(journal); throw error; }
    step.status = "confirmed"; await persist(journal);
    console.log(`Confirmed ${specification.id}: ${step.hash}`);
  }
  const verification = await verifyRelease(plan, client);
  journal.status = "verified"; journal.verification = verification;
  await persist(journal);
  return verification;
}
