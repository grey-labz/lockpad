import test from "node:test";
import assert from "node:assert/strict";
import { formatAmount, timestampMs, timeLeft, toUnits, tradeMath, U128_MAX } from "../src/lib/amounts.mjs";

test("decimal input and six-decimal token amounts round-trip without floating point", () => {
  for (const [input, expected] of [["0.000001", "1"], ["920", "920000000"], ["001.230000", "1230000"], ["123456789123456789.123456", "123456789123456789123456"]]) assert.equal(toUnits(input), expected);
  assert.equal(toUnits(formatAmount(U128_MAX).replaceAll(",", "")), U128_MAX.toString());
  assert.equal(formatAmount("920000001"), "920.000001");
  assert.equal(formatAmount("0"), "0");
});

for (const input of ["", "0", "0.000000", "-1", "+1", "1e3", "1,000", ".5", "1.", "0.0000001", "Infinity", "NaN"]) {
  test("invalid amount is rejected: " + JSON.stringify(input), () => assert.throws(() => toUnits(input)));
}

test("token amounts beyond the contract's u128 limit are rejected", () => {
  assert.throws(() => toUnits(formatAmount(U128_MAX + 1n).replaceAll(",", "")));
  assert.throws(() => formatAmount("-1"));
});

test("the 1000/920 example distinguishes discount from return on purchase price", () => {
  assert.deepEqual(tradeMath("1000000000", "920000000"), { profit: "80000000", discount: "8.00", returnOnPrice: "8.70" });
  // Only display percentages are rounded; payment amounts remain exact integers.
  assert.equal(tradeMath("1000000000", "900000000").returnOnPrice, "11.11");
});

test("invalid sale prices cannot produce a purchase quote", () => {
  for (const [payout, price] of [["0", "1"], ["100", "0"], ["100", "100"], ["100", "101"]]) assert.throws(() => tradeMath(payout, price));
});

test("nanosecond maturity becomes a claim exactly at its original timestamp", () => {
  const now = 1_800_000_000_000;
  const unlock = (BigInt(now) * 1_000_000n).toString();
  assert.equal(timestampMs(unlock), now);
  assert.equal(timeLeft(unlock, now), "Ready to claim");
  assert.equal(timeLeft(unlock, now - 1), "1 sec");
  assert.equal(timeLeft(unlock, now - 60_000), "1 min");
});
