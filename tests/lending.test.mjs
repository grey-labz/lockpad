import test from "node:test";
import assert from "node:assert/strict";
import { loanMath, loanState } from "../src/lib/lending.mjs";
import { U128_MAX } from "../src/lib/amounts.mjs";

test("a 1000 TUSD payout supports a 650 loan with 663 due and 337 remaining", () => {
  assert.deepEqual(loanMath("1000000000", "650000000"), {
    amount: "650000000", maximum: "650000000", fee: "13000000", repayment: "663000000", surplus: "337000000",
  });
});

test("pool liquidity can reduce an offer but cannot increase its collateral limit", () => {
  assert.equal(loanMath("1000000000", "400000000", { liquidity: "400000000" }).maximum, "400000000");
  assert.throws(() => loanMath("1000000000", "400000001", { liquidity: "400000000" }), /exceeds/);
  assert.throws(() => loanMath("1000000000", "650000001", { liquidity: "900000000" }), /exceeds/);
  assert.throws(() => loanMath("1000000000", "1", { liquidity: "0" }), /exceeds/);
});

test("fees round up to an indivisible token unit without losing the last collateral unit", () => {
  assert.deepEqual(loanMath("2", "1"), { amount: "1", maximum: "1", fee: "1", repayment: "2", surplus: "0" });
  assert.equal(loanMath("100", "49", { feeBps: 0 }).fee, "0");
  assert.throws(() => loanMath("1", "1"), /exceeds/);
});

test("large token amounts retain exact integers and stay within the original payout", () => {
  const amount = U128_MAX * 95n / 100n;
  const quote = loanMath(U128_MAX.toString(), amount.toString(), { ltvBps: 9500, feeBps: 500 });
  assert.equal(BigInt(quote.repayment) + BigInt(quote.surplus), U128_MAX);
  assert.ok(BigInt(quote.repayment) <= U128_MAX);
  assert.throws(() => loanMath((U128_MAX + 1n).toString(), "1"), /supported range/);
  assert.throws(() => loanMath("100", "1", { liquidity: (U128_MAX + 1n).toString() }), /supported range/);
});

test("invalid borrowing amounts and unavailable risk terms cannot produce offers", () => {
  for (const amount of ["0", "-1", "101"]) assert.throws(() => loanMath("100", amount));
  for (const ltvBps of [0, -1, 6500.5, 9501, NaN]) assert.throws(() => loanMath("100", "1", { ltvBps }), /terms/);
  for (const feeBps of [-1, 200.1, 501, NaN]) assert.throws(() => loanMath("100", "1", { feeBps }), /terms/);
});

test("a loan becomes due exactly at its original maturity", () => {
  const now = 1_800_000_000_000;
  const loan = { status: "Active", unlock_at: (BigInt(now) * 1_000_000n).toString() };
  assert.deepEqual(loanState(loan, now - 1), { label: "Active loan", mature: false });
  assert.deepEqual(loanState(loan, now), { label: "Maturity reached", mature: true });
});

test("pending and unknown receipts are never described as repaid collateral", () => {
  const unlock_at = "1800000000000000000";
  for (const [status, label] of [["Disbursing", "Payment pending"], ["RepaymentReady", "Repaid · return pending"], ["Returning", "Returning collateral"], ["Settling", "Payout settling"], ["Unrecognized", "Review receipt"]]) assert.equal(loanState({ status, unlock_at }, 0).label, label);
});
