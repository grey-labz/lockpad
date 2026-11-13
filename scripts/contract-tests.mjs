import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createSandbox, GAS, ONE, STORAGE, OPERATION_STORAGE, project } from "./sandbox.mjs";
import { join } from "node:path";

const receipts = [];
const checks = [];
const sandbox = await createSandbox({ onReceipt: result => receipts.push(result) });
const { accounts: { alice: seller, bob: buyer, stranger }, token, vault, market, worker, send, lock, list } = sandbox;
const check = (name, assertion) => { assertion(); checks.push(name); console.log("PASS:", name); };
const ledger = account => market.view("get_account", { account_id: account.accountId });
const position = tokenId => vault.view("get_position", { token_id: tokenId });
const balance = account => token.view("ft_balance_of", { account_id: account.accountId });
const deposit = (account, amount, msg = { action: "deposit" }) => send(account, token, "ft_transfer_call", {
  receiver_id: market.accountId, amount, msg: JSON.stringify(msg),
});
const buy = (account, listing, nonce = listing.quote_nonce) => send(account, market, "buy", { listing_id: listing.id, quote_nonce: nonce }, OPERATION_STORAGE);
const assertSolvent = async () => {
  const accounting = await market.view("get_accounting", {});
  const liabilities = ["available", "proceeds", "reserved_purchases", "pending_withdrawals"].reduce((sum, key) => sum + BigInt(accounting[key]), 0n);
  assert.equal(BigInt(await balance(market)), liabilities);
};

try {
  const p = await lock(seller, "100000000", 60);
  check("A separate vault holds the full principal", () => assert.equal(p.principal, "100000000"));
  assert.equal(await balance(vault), "100000000");
  const early = await send(seller, vault, "redeem", { token_id: p.token_id });
  check("Early principal redemption is rejected", () => assert.equal(early.failed, true));
  await send(seller, market, "prepay_listing", {}, STORAGE);
  const invalidPrice = await send(seller, vault, "nft_transfer_call", { receiver_id: market.accountId, token_id: p.token_id, msg: JSON.stringify({ price: p.principal }) });
  check("A non-discounted listing returns its NFT", () => assert.equal(invalidPrice.parseResult(), false));
  assert.equal((await position(p.token_id)).owner_id, seller.accountId);
  assert.equal((await ledger(seller)).listing_credits, 1);
  const forgedOwner = await send(buyer, vault, "nft_transfer_call", { receiver_id: market.accountId, token_id: p.token_id, msg: JSON.stringify({ price: "92000000" }) });
  check("Another account cannot sell the owner's lock", () => assert.equal(forgedOwner.failed, true));
  // Use the retained credit from the rejected listing.
  const listed = await send(seller, vault, "nft_transfer_call", { receiver_id: market.accountId, token_id: p.token_id, msg: JSON.stringify({ price: "92000000" }) });
  assert.equal(listed.parseResult(), true);
  const listing = (await market.view("get_listings", { from_index: 0, limit: 10 }))[0];
  check("Only the payout NFT enters the marketplace", () => assert.equal(listing.source_id, vault.accountId));
  assert.equal((await position(p.token_id)).owner_id, market.accountId);
  assert.equal(await balance(vault), "100000000");
  assert.equal(await balance(market), "0");

  const unsupported = await send(stranger, market, "ft_on_transfer", { sender_id: buyer.accountId, amount: "900000000", msg: JSON.stringify({ action: "deposit" }) }, "0");
  check("Forged token deposits never create credit", () => assert.equal(unsupported.parseResult(), "900000000"));
  assert.equal((await ledger(buyer)).available, "0");
  assert.equal((await deposit(buyer, "92000000", { action: "buy" })).parseResult(), "0");
  assert.equal((await deposit(buyer, "92000000")).parseResult(), "92000000");
  await assertSolvent();
  const stale = await buy(buyer, listing, "999");
  check("A stale quote cannot spend a buyer's deposit", () => assert.equal(stale.failed, true));
  assert.equal((await ledger(buyer)).available, "92000000");
  const selfPurchase = await buy(seller, listing);
  check("Self-purchases are rejected", () => assert.equal(selfPurchase.failed, true));
  const sale = await buy(buyer, listing);
  check("A purchase transfers the original NFT to the buyer", () => assert.equal(sale.parseResult(), true));
  const purchased = await position(p.token_id);
  assert.equal(purchased.owner_id, buyer.accountId);
  assert.equal(purchased.principal, p.principal);
  assert.equal(purchased.unlock_at, p.unlock_at);
  check("Sale preserves principal and original maturity", () => assert.equal(purchased.unlock_at, p.unlock_at));
  assert.equal((await ledger(seller)).proceeds, "92000000");
  assert.equal((await ledger(buyer)).available, "0");
  const sold = await market.view("get_listing", { listing_id: listing.id });
  assert.equal(sold.status, "Sold");
  assert.equal((await buy(buyer, listing)).failed, true);
  check("A sold lock cannot be purchased twice", () => assert.equal(sold.status, "Sold"));
  await assertSolvent();

  await send(seller, token, "storage_unregister", { force: true });
  const failedWithdraw = await send(seller, market, "withdraw_proceeds", {});
  check("Failed seller payout restores withdrawable proceeds", () => assert.equal(failedWithdraw.parseResult(), false));
  assert.equal((await ledger(seller)).proceeds, "92000000");
  await assertSolvent();
  const bounds = await token.view("storage_balance_bounds", {});
  await send(seller, token, "storage_deposit", { registration_only: true }, bounds.min);
  const withdrawal = await send(seller, market, "withdraw_proceeds", {});
  assert.equal(withdrawal.parseResult(), true);
  assert.equal(await balance(seller), "92000000");
  check("The seller receives the agreed early-exit payment", () => assert.equal(withdrawal.parseResult(), true));
  assert.equal((await send(seller, market, "withdraw_proceeds", {})).failed, true);
  await assertSolvent();

  console.log("Waiting for the real one-minute onchain maturity…");
  for (let attempt = 0; attempt < 45; attempt++) {
    if (BigInt((await vault.view("get_config", {})).timestamp) >= BigInt(p.unlock_at)) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  const config = await vault.view("get_config", {});
  assert.ok(BigInt(config.timestamp) >= BigInt(p.unlock_at));
  assert.equal((await send(seller, vault, "redeem", { token_id: p.token_id })).failed, true);
  check("Only the current NFT owner can claim at maturity", () => assert.equal(purchased.owner_id, buyer.accountId));
  await send(buyer, token, "storage_unregister", { force: true });
  const failedClaim = await send(buyer, vault, "redeem", { token_id: p.token_id });
  assert.equal(failedClaim.parseResult(), false);
  assert.equal((await position(p.token_id)).status, "Active");
  check("A failed maturity payout preserves the right to retry", () => assert.equal(failedClaim.parseResult(), false));
  await send(buyer, token, "storage_deposit", { registration_only: true }, bounds.min);
  const claim = await send(buyer, vault, "redeem", { token_id: p.token_id });
  assert.equal(claim.parseResult(), true);
  assert.equal(await balance(buyer), "100000000");
  assert.equal(await balance(vault), "0");
  assert.equal((await position(p.token_id)).status, "Redeemed");
  check("The buyer receives the full original principal", () => assert.equal(claim.parseResult(), true));
  assert.equal((await send(buyer, vault, "redeem", { token_id: p.token_id })).failed, true);
  check("The principal cannot be redeemed twice", () => assert.equal(claim.parseResult(), true));
  await assertSolvent();

  await send(seller, token, "faucet", {}, "0");
  const cancelPosition = await lock(seller, "10000000", 604800);
  const cancelListing = await list(seller, cancelPosition.token_id, "9000000");
  assert.equal((await send(buyer, market, "cancel_listing", { listing_id: cancelListing.id }, OPERATION_STORAGE)).failed, true);
  assert.equal((await send(seller, market, "cancel_listing", { listing_id: cancelListing.id }, OPERATION_STORAGE)).parseResult(), true);
  assert.equal((await position(cancelPosition.token_id)).owner_id, seller.accountId);
  check("Cancellation returns the unsold payout right to its seller", () => assert.equal(cancelListing.seller_id, seller.accountId));
  await deposit(buyer, "9000000");
  assert.equal((await buy(buyer, cancelListing)).failed, true);
  assert.equal((await ledger(buyer)).available, "9000000");
  assert.equal((await send(buyer, market, "withdraw_balance", {})).parseResult(), true);
  check("Unused buyer funding is recoverable after cancellation", () => assert.equal(cancelListing.price, "9000000"));
  await assertSolvent();
  await mkdir(join(project, "docs/evidence"), { recursive: true });
  await writeFile(join(project, "docs/evidence/contract-tests.json"), JSON.stringify({ network: "local NEAR Sandbox", executedAt: new Date().toISOString(), checks, accounts: Object.fromEntries(Object.entries(sandbox.accounts).map(([k, v]) => [k, v.accountId])), receipts }, null, 2) + "\n");
  console.log(`PASS: ${checks.length} contract behavior checks; real Sandbox transaction receipts saved.`);
} finally {
  await sandbox.close();
}
