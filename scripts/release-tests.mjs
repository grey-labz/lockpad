import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import { createSandbox, STORAGE, OPERATION_STORAGE } from "./sandbox.mjs";
import { createReleasePlan, createRPC, createSigner, deployRelease, verifyRelease, saveJSON, sha256, project } from "./lib/release.mjs";
import { verifyTrade } from "./lib/trade-proof.mjs";

const checks = [], record = name => { checks.push(name); console.log("PASS:", name); };
const temporary = await mkdtemp(join(tmpdir(), "lockpad-release-sandbox-"));
let sandbox;
try {
  sandbox = await createSandbox();
  const accounts = {}, pairs = new Map();
  for (const role of ["token", "vault", "market"]) {
    const account = await sandbox.worker.rootAccount.createSubAccount("release-" + role, { initialBalance: "10000000000000000000000000" });
    accounts[role] = account.accountId;
    pairs.set(account.accountId, KeyPair.fromString((await account.getKey()).toString()));
  }
  const plan = await createReleasePlan({ accounts, network: "sandbox", rpc: sandbox.worker.config.rpcAddr });
  const client = createRPC(plan.rpc);
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await Promise.all(Object.values(accounts).map(id => client.account(id)))).every(Boolean)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const realSigner = await createSigner(plan, client, pairs);
  const journalPath = join(temporary, "deployment-journal.json");
  const journal = { releaseId: plan.id, network: "sandbox", steps: {} };
  const persist = value => saveJSON(journalPath, value);
  let signatures = 0, broadcasts = 0;
  const signer = { check: realSigner.check, prepare: async (...args) => { signatures++; return realSigner.prepare(...args); } };
  const interrupted = { ...client, broadcast: async signed => {
    const saved = JSON.parse(await readFile(journalPath));
    assert.equal(saved.steps["deploy:token"].status, "prepared");
    assert.ok(saved.steps["deploy:token"].hash);
    broadcasts++; await client.broadcast(signed);
    throw new Error("Simulated lost RPC response after actual local deployment");
  } };
  await assert.rejects(deployRelease(plan, interrupted, signer, journal, persist), /confirmation is unavailable/);
  assert.equal(signatures, 1); assert.equal(broadcasts, 1);
  record("The exact transaction hash is persisted before broadcast; a lost response stops later signatures");
  const unavailable = { ...client, receipt: async () => { throw new Error("Simulated unavailable receipt"); } };
  await assert.rejects(deployRelease(plan, unavailable, signer, journal, persist), /will not be signed again/);
  assert.equal(signatures, 1);
  record("An unavailable recorded receipt cannot trigger a retry or another transaction");
  const counted = { ...client, broadcast: async signed => { broadcasts++; return client.broadcast(signed); } };
  const verification = await deployRelease(plan, counted, signer, journal, persist);
  assert.equal(verification.status, "PASS");
  assert.equal(signatures, 5); assert.equal(broadcasts, 5);
  record("Resume confirms the original deployment receipt and signs only the four remaining steps");
  assert.equal(verification.contracts.length, 3);
  assert.deepEqual(verification.marketConfig.source_ids, [accounts.vault]);
  assert.equal(verification.marketConfig.asset_id, accounts.token);
  assert.equal(verification.sourceConfig.asset_id, accounts.token);
  record("Three actual Wasm deployments have the exact code hashes, token and source initializers");
  assert.ok(verification.registrations.vault && verification.registrations.market);
  assert.equal(verification.tokenMetadata.decimals, 6);
  record("Both external contracts are registered with the six-decimal test token");
  await deployRelease(plan, counted, signer, journal, persist);
  assert.equal(signatures, 5); assert.equal(broadcasts, 5);
  record("Rerunning a completed deployment only reads receipts and configuration");
  await assert.rejects(deployRelease(plan, counted, signer, { releaseId: plan.id, steps: {} }, persist), /outside this deployment journal/);
  assert.equal(signatures, 5);
  record("Existing contracts cannot be overwritten through a new or missing journal");
  const readOnly = { ...client, broadcast: async () => { throw new Error("Verification must not broadcast"); } };
  const again = await verifyRelease(plan, readOnly);
  assert.equal(again.status, "PASS"); assert.equal(signatures, 5);
  record("Independent code, configuration and registration verification is read-only at one final block");
  const missingRegistration = { ...readOnly, view: async (id, method, args, block) => method === "storage_balance_of" && args.account_id === accounts.market ? null : client.view(id, method, args, block) };
  await assert.rejects(verifyRelease(plan, missingRegistration), /not registered/);
  record("A missing marketplace token registration fails release verification");
  const { alice: seller, bob: buyer } = sandbox.accounts;
  const token = sandbox.worker.rootAccount.getAccount(accounts.token), vault = sandbox.worker.rootAccount.getAccount(accounts.vault), market = sandbox.worker.rootAccount.getAccount(accounts.market);
  const send = sandbox.send;
  const bounds = await token.view("storage_balance_bounds", {});
  for (const actor of [seller, buyer]) {
    await send(actor, token, "storage_deposit", { account_id: actor.accountId, registration_only: true }, bounds.min);
    await send(actor, market, "register_account", {}, STORAGE);
    await send(actor, token, "faucet", {}, "0");
  }
  await send(seller, vault, "prepay_lock", {}, STORAGE);
  assert.equal((await send(seller, token, "ft_transfer_call", { receiver_id: vault.accountId, amount: "1000000000", msg: JSON.stringify({ action: "lock", duration: 60 }) })).parseResult(), "1000000000");
  const original = (await vault.view("get_positions_by_owner", { owner_id: seller.accountId, from_index: "0", limit: 10 }))[0];
  await send(seller, market, "prepay_listing", {}, STORAGE);
  const listed = await send(seller, vault, "nft_transfer_call", { receiver_id: market.accountId, token_id: original.token_id, msg: JSON.stringify({ price: "920000000" }) });
  const listing = (await market.view("get_listings", { from_index: 0, limit: 10 }))[0];
  const funding = await send(buyer, token, "ft_transfer_call", { receiver_id: market.accountId, amount: listing.price, msg: JSON.stringify({ action: "deposit" }) });
  const purchase = await send(buyer, market, "buy", { listing_id: listing.id, quote_nonce: listing.quote_nonce }, OPERATION_STORAGE);
  const withdrawal = await send(seller, market, "withdraw_proceeds", {});
  await sandbox.worker.provider.fastForward(600);
  const redemption = await send(buyer, vault, "redeem", { token_id: original.token_id });
  const proof = { releaseId: plan.id, listingId: listing.id, sellerId: seller.accountId, buyerId: buyer.accountId, transactions: Object.fromEntries(Object.entries({ listing: listed, funding, purchase, withdrawal, redemption }).map(([name, outcome]) => [name, outcome.result.transaction.hash])) };
  const tradeVerification = await verifyTrade(plan, proof, readOnly);
  assert.equal(tradeVerification.sellerPayment, "920000000");
  assert.equal(tradeVerification.buyerPayout, "1000000000");
  assert.equal(tradeVerification.position.unlock_at, original.unlock_at);
  record("Five real trade receipts prove NFT sale, accepted funding, 920 TUSD seller payout and 1000 TUSD original-maturity redemption");
  await assert.rejects(verifyTrade(plan, { ...proof, transactions: { ...proof.transactions, redemption: proof.transactions.withdrawal } }, readOnly), /five distinct transaction hashes/);
  record("A reused payout receipt cannot be presented as a separate maturity claim");
  const sources = {};
  for (const file of ["scripts/lib/release.mjs", "scripts/lib/trade-proof.mjs", "scripts/release-tests.mjs", "scripts/sandbox.mjs"]) sources[file] = sha256(await readFile(join(project, file)));
  await saveJSON(join(project, "docs/evidence/release-tests.json"), { status: "PASS", network: "isolated local NEAR Sandbox", actors: "Temporary builder-controlled deployment accounts; no public testnet or independent wallet acceptance", executedAt: new Date().toISOString(), checks, signatures, broadcasts, verification, steps: journal.steps, tradeVerification, proof, sources });
  console.log(`PASS: ${checks.length} release checks against actual local Wasm; ${signatures} distinct signatures, ${broadcasts} broadcasts.`);
} finally {
  if (sandbox) await sandbox.close();
  await rm(temporary, { recursive: true, force: true });
}
