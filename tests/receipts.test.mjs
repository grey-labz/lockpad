import test from "node:test";
import assert from "node:assert/strict";
import { action, assertOutcome } from "../src/lib/chain.mjs";

const success = raw => ({ status: { SuccessValue: btoa(raw) } });
test("unknown, pending and failed execution never become a success notification", () => {
  for (const result of [undefined, {}, { status: "Unknown" }, { status: { SuccessReceiptId: "pending" } }, { status: { Failure: { error: "rejected" } } }, { status: { SuccessValue: "!invalid!" } }]) assert.throws(() => assertOutcome(result, action("market.test.near", "buy")));
});
test("returned or partially accepted FT funding cannot authorize a follow-on purchase", () => {
  const request = action("token.test.near", "ft_transfer_call", { amount: "920000000" });
  assert.doesNotThrow(() => assertOutcome(success('"920000000"'), request));
  for (const raw of ['"0"', '"500000000"', "false"]) assert.throws(() => assertOutcome(success(raw), request));
});
test("failed payout callbacks remain actionable failures", () => {
  for (const method of ["buy", "redeem", "withdraw_proceeds", "nft_transfer_call"]) assert.throws(() => assertOutcome(success("false"), action("market.test.near", method)));
  assert.doesNotThrow(() => assertOutcome(success("true"), action("market.test.near", "buy")));
});
test("a reconciliation may confirm a failed delivery and restore funding", () => {
  assert.doesNotThrow(() => assertOutcome(success("false"), { ...action("market.test.near", "reconcile"), allowFalse: true }));
});
