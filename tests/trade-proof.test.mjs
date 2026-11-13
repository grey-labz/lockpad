import assert from "node:assert/strict";
import { test } from "node:test";
import { assertTradeAction, assertTokenPayout } from "../scripts/lib/trade-proof.mjs";

test("Trade evidence binds signer, receiver, method, arguments and callback result", () => {
  const outcome = { transaction: { hash: "hash", signer_id: "buyer.testnet", receiver_id: "market.testnet", actions: [{ FunctionCall: { method_name: "buy", args: Buffer.from(JSON.stringify({ listing_id: "4", quote_nonce: "7" })).toString("base64") } }] }, status: { SuccessValue: Buffer.from("true").toString("base64") }, receipts_outcome: [] };
  assert.equal(assertTradeAction(outcome, "buyer.testnet", "market.testnet", "buy", { listing_id: "4" }).result, true);
  assert.throws(() => assertTradeAction(outcome, "buyer.testnet", "other.testnet", "buy"), /does not match/);
  assert.throws(() => assertTradeAction(outcome, "buyer.testnet", "market.testnet", "redeem"), /different method/);
  assert.throws(() => assertTradeAction(outcome, "buyer.testnet", "market.testnet", "buy", { listing_id: "5" }), /does not match/);
});

test("A payout proof needs the exact asset, sender, recipient and integer amount", () => {
  const log = "EVENT_JSON:" + JSON.stringify({ standard: "nep141", event: "ft_transfer", data: [{ old_owner_id: "vault.testnet", new_owner_id: "buyer.testnet", amount: "1000000000" }] });
  const outcome = { receipts_outcome: [{ outcome: { executor_id: "token.testnet", logs: [log] } }] };
  assertTokenPayout(outcome, "vault.testnet", "buyer.testnet", "1000000000", "token.testnet");
  assert.throws(() => assertTokenPayout(outcome, "vault.testnet", "buyer.testnet", "1000000001", "token.testnet"), /no matching/);
  assert.throws(() => assertTokenPayout(outcome, "vault.testnet", "buyer.testnet", "1000000000", "other-token.testnet"), /no matching/);
});
