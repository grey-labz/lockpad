import assert from "node:assert/strict";
import { assertFinalReceipt, validateAccounts, verifyRelease } from "./release.mjs";

export function assertTradeAction(outcome, signerId, receiverId, methodName, expectedArgs = {}) {
  assertFinalReceipt(outcome, { hash: outcome.transaction?.hash, signerId, receiverId });
  assert.equal(outcome.transaction.actions.length, 1, "The proof transaction must contain one reviewed action");
  const call = outcome.transaction.actions[0].FunctionCall;
  assert.equal(call?.method_name, methodName, "The receipt contains a different method");
  const args = JSON.parse(Buffer.from(call.args, "base64").toString("utf8"));
  for (const [key, value] of Object.entries(expectedArgs)) assert.deepEqual(args[key], value, `Receipt argument ${key} does not match`);
  const result = outcome.status.SuccessValue ? JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString("utf8")) : undefined;
  return { args, result };
}

export function assertTokenPayout(outcome, senderId, receiverId, amount, tokenId) {
  const transfers = outcome.receipts_outcome.filter(receipt => receipt.outcome.executor_id === tokenId).flatMap(receipt => receipt.outcome.logs || []).flatMap(log => {
    if (!log.startsWith("EVENT_JSON:")) return [];
    try { const event = JSON.parse(log.slice(11)); return event.standard === "nep141" && event.event === "ft_transfer" ? event.data || [] : []; }
    catch { return []; }
  });
  assert.ok(transfers.some(transfer => transfer.old_owner_id === senderId && transfer.new_owner_id === receiverId && transfer.amount === amount), "The receipt has no matching token payout event");
}

export async function verifyTrade(plan, proof, client) {
  assert.equal(proof.releaseId, plan.id, "The trade belongs to another release");
  validateAccounts({ token: proof.sellerId, vault: proof.buyerId, market: plan.accounts.token }, plan.network);
  assert.ok(!Object.values(plan.accounts).includes(proof.sellerId) && !Object.values(plan.accounts).includes(proof.buyerId), "Trade actors must be separate from contract accounts");
  assert.match(proof.listingId, /^[1-9]\d*$/, "A positive listing ID is required");
  const names = ["listing", "funding", "purchase", "withdrawal", "redemption"];
  const hashes = names.map(name => proof.transactions?.[name]);
  assert.ok(hashes.every(hash => typeof hash === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash)) && new Set(hashes).size === names.length, "Provide five distinct transaction hashes from the complete trade");
  const signers = { listing: proof.sellerId, funding: proof.buyerId, purchase: proof.buyerId, withdrawal: proof.sellerId, redemption: proof.buyerId };
  const receipts = Object.fromEntries(await Promise.all(names.map(async name => [name, await client.receipt(proof.transactions[name], signers[name])])));
  for (const name of names) assert.equal(receipts[name].transaction?.hash, proof.transactions[name], "RPC returned a different trade transaction");
  // Wait for all five FINAL receipts before taking the single state snapshot.
  // In particular, an optimistic redemption result may precede its accounting callback.
  const deployment = await verifyRelease(plan, client), block = deployment.block.hash;
  const { token, vault, market } = plan.accounts;
  const listing = await client.view(market, "get_listing", { listing_id: proof.listingId }, block);
  assert.ok(listing, "The listing does not exist");
  assert.equal(listing.source_id, vault);
  assert.equal(listing.seller_id, proof.sellerId);
  assert.equal(listing.buyer_id, proof.buyerId);
  assert.equal(listing.status, "Sold");
  const position = await client.view(vault, "get_position", { token_id: listing.token_id }, block);
  assert.equal(position?.owner_id, proof.buyerId);
  assert.equal(position?.status, "Redeemed");
  assert.equal(position?.principal, listing.payout);
  assert.equal(position?.unlock_at, listing.unlock_at);
  assert.equal(position?.created_at, listing.source_created_at);
  const listed = assertTradeAction(receipts.listing, proof.sellerId, vault, "nft_transfer_call", { receiver_id: market, token_id: listing.token_id });
  assert.equal(JSON.parse(listed.args.msg).price, listing.price);
  assert.equal(listed.result, true);
  const funded = assertTradeAction(receipts.funding, proof.buyerId, token, "ft_transfer_call", { receiver_id: market, amount: listing.price });
  assert.deepEqual(JSON.parse(funded.args.msg), { action: "deposit" });
  assert.equal(funded.result, listing.price, "The full purchase funding was not accepted");
  assert.equal(assertTradeAction(receipts.purchase, proof.buyerId, market, "buy", { listing_id: listing.id, quote_nonce: listing.quote_nonce }).result, true);
  assert.equal(assertTradeAction(receipts.withdrawal, proof.sellerId, market, "withdraw_proceeds").result, true);
  assertTokenPayout(receipts.withdrawal, market, proof.sellerId, listing.price, token);
  assert.equal(assertTradeAction(receipts.redemption, proof.buyerId, vault, "redeem", { token_id: listing.token_id }).result, true);
  assertTokenPayout(receipts.redemption, vault, proof.buyerId, listing.payout, token);
  return { schema: "lockpad-trade-verification-v1", status: "PASS", verifiedAt: new Date().toISOString(), network: plan.network, releaseId: plan.id, block: deployment.block, listing, position, sellerPayment: listing.price, buyerPayout: listing.payout, transactions: proof.transactions, actors: "Receipt-backed wallet workflow; this verification alone does not establish independent adoption" };
}
