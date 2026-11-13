import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createReleasePlan, readReleasePlan, validateAccounts, validateRPC, assertFinalReceipt, deployRelease, EMPTY_CODE, project } from "../scripts/lib/release.mjs";

const accounts = { token: "lockpad-test-token.testnet", vault: "lockpad-test-vault.testnet", market: "lockpad-test-market.testnet" };

test("The release binds all three artifacts, exact initializers and external token registrations", async () => {
  const first = await createReleasePlan({ accounts }), second = await createReleasePlan({ accounts });
  assert.equal(first.id, second.id);
  assert.deepEqual(first.contracts.map(item => item.role), ["token", "vault", "market"]);
  assert.deepEqual(first.contracts.map(item => item.initializer), [{}, { asset_id: accounts.token }, { asset_id: accounts.token, source_ids: [accounts.vault] }]);
  assert.deepEqual(first.registrations.map(item => item.args.account_id), [accounts.vault, accounts.market]);
  assert.equal(first.frontend.VITE_MARKET_ACCOUNT, accounts.market);
  assert.notEqual(first.id, (await createReleasePlan({ accounts: { ...accounts, market: "other-market.testnet" } })).id);
});

test("Public deployment rejects mainnet, duplicate accounts and credential-bearing RPC URLs", () => {
  assert.throws(() => validateAccounts({ ...accounts, market: "lockpad.near" }));
  assert.throws(() => validateAccounts({ ...accounts, market: accounts.token }));
  assert.throws(() => validateAccounts(accounts, "mainnet"));
  assert.throws(() => validateRPC("https://rpc.example.com/?api_key=example", "testnet"));
  assert.throws(() => validateRPC("http://127.0.0.1:3030", "testnet"));
});

test("Changing reviewed actions or a Wasm artifact invalidates the saved plan", async t => {
  const directory = await mkdtemp(join(tmpdir(), "lockpad-release-unit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const plan = await createReleasePlan({ accounts }), path = join(directory, "plan.json");
  await writeFile(path, JSON.stringify(plan));
  assert.equal((await readReleasePlan(path)).id, plan.id);
  const edited = structuredClone(plan);
  edited.contracts[2].initializer.source_ids = [accounts.token];
  await writeFile(path, JSON.stringify(edited));
  await assert.rejects(readReleasePlan(path), /differs/);
  const manifest = JSON.parse(await readFile(join(project, "docs/evidence/contract-build.json")));
  for (const file of [...Object.keys(manifest.sources), ...Object.keys(manifest.contracts).map(file => "res/" + file), "docs/evidence/contract-build.json"]) {
    await mkdir(dirname(join(directory, file)), { recursive: true });
    await copyFile(join(project, file), join(directory, file));
  }
  await writeFile(join(directory, "res/lockpad_marketplace.wasm"), "changed artifact");
  await assert.rejects(createReleasePlan({ accounts }, directory), /artifact mismatch/);
});

test("A failed callback, unknown result or wrong transaction cannot advance deployment", () => {
  const step = { hash: "hash", signerId: accounts.vault, receiverId: accounts.token };
  const valid = { transaction: { hash: step.hash, signer_id: step.signerId, receiver_id: step.receiverId }, status: { SuccessValue: "" }, receipts_outcome: [] };
  assertFinalReceipt(valid, step);
  assert.throws(() => assertFinalReceipt({ ...valid, transaction: { ...valid.transaction, signer_id: accounts.market } }, step), /does not match/);
  assert.throws(() => assertFinalReceipt({ ...valid, status: { SuccessReceiptId: "pending" } }, step), /failed or incomplete/);
  assert.throws(() => assertFinalReceipt({ ...valid, receipts_outcome: [{ outcome: { status: { Failure: {} } } }] }, step), /failed or incomplete/);
});

test("An unknown deployment receipt stops all later signatures", async () => {
  const plan = await createReleasePlan({ accounts });
  let signatures = 0;
  const signer = { check: async () => {}, prepare: async () => { signatures++; throw new Error("Unexpected signature"); } };
  const journal = { releaseId: plan.id, steps: { "deploy:token": { signerId: accounts.token, receiverId: accounts.token, hash: "pending-hash" } } };
  await assert.rejects(deployRelease(plan, { receipt: async () => { throw new Error("Unavailable"); } }, signer, journal, async () => {}), /pending-hash/);
  assert.equal(signatures, 0);
});

test("Preflight refuses an existing deployment even if its code matches", async () => {
  const plan = await createReleasePlan({ accounts });
  let signatures = 0;
  const client = {
    head: async () => ({ status: { chain_id: "testnet" }, block: { header: { hash: "block" } } }),
    account: async id => ({ code_hash: plan.contracts.find(item => item.accountId === id).codeHash, amount: "10000000000000000000000000", locked: "0" }),
  };
  const signer = { check: async () => {}, prepare: async () => { signatures++; } };
  await assert.rejects(deployRelease(plan, client, signer, { releaseId: plan.id, steps: {} }, async () => {}), /outside this deployment journal/);
  assert.equal(signatures, 0);
});

test("Wrong-chain and underfunded accounts are rejected before the first signature", async () => {
  const plan = await createReleasePlan({ accounts });
  let signatures = 0;
  const signer = { check: async () => {}, prepare: async () => { signatures++; } };
  const client = {
    head: async () => ({ status: { chain_id: "mainnet" }, block: { header: { hash: "block" } } }),
    account: async () => ({ code_hash: EMPTY_CODE, amount: "0", locked: "0" }),
  };
  await assert.rejects(deployRelease(plan, client, signer, { releaseId: plan.id, steps: {} }, async () => {}), /reports mainnet/);
  client.head = async () => ({ status: { chain_id: "testnet" }, block: { header: { hash: "block" } } });
  await assert.rejects(deployRelease(plan, client, signer, { releaseId: plan.id, steps: {} }, async () => {}), /needs more test NEAR/);
  assert.equal(signatures, 0);
});
