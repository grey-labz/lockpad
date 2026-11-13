import test from "node:test";
import assert from "node:assert/strict";
import { assertEligible, selectListings } from "../src/lib/market.mjs";
import { DAY } from "../src/lib/amounts.mjs";

const now = 1_800_000_000_000;
const timestamp = milliseconds => (BigInt(milliseconds) * 1_000_000n).toString();
const listing = (id, days, price, status = "Open") => ({ id, token_id: id, source_id: "vault.test.near", seller_id: "alice.test.near", payout: "1000000000", price, unlock_at: timestamp(now + days * DAY), status });
const listings = [listing("1", 7, "960000000"), listing("2", 30, "920000000"), listing("3", 90, "900000000"), listing("4", 1, "900000000", "Buying"), listing("5", 0, "900000000"), listing("6", 1, "900000000", "Sold")];

test("only open, unmatured positions can be offered for purchase", () => {
  assert.deepEqual(selectListings(listings, { now }).map(item => item.id), ["1", "2", "3"]);
});
test("maturity filters partition positions at seven and thirty days", () => {
  for (const [maturity, expected] of [["week", ["1"]], ["month", ["2"]], ["later", ["3"]]]) assert.deepEqual(selectListings(listings, { now, maturity }).map(item => item.id), expected);
});
test("search and discount filters combine without creating sample results", () => {
  assert.equal(selectListings(listings, { now, query: "Alice", discount: "5" }).length, 2);
  assert.equal(selectListings(listings, { now, query: "not-an-owner" }).length, 0);
  assert.deepEqual(selectListings(listings, { now, discount: "10" }).map(item => item.id), ["3"]);
  assert.equal(selectListings([listing("9", 7, "950001000")], { now, discount: "5" }).length, 0);
});
test("discount and price sorts preserve integer precision", () => {
  assert.deepEqual(selectListings(listings, { now, sort: "discount" }).map(item => item.id), ["3", "2", "1"]);
  assert.deepEqual(selectListings(listings, { now, sort: "price" }).map(item => item.id), ["3", "2", "1"]);
  const full = "1000000000000000000000000000000";
  const close = [listing("10", 1, "900000000000000000000000000001"), listing("11", 1, "900000000000000000000000000000")].map(item => ({ ...item, payout: full }));
  assert.equal(selectListings(close, { now, sort: "discount" })[0].id, "11");
});

const environment = { vault: "vault.test.near", token: "token.test.near" };
const position = { token_id: "1", owner_id: "alice.test.near", adapter_version: "lockpad-reference-v1", asset_id: environment.token, principal: "1000000000", unlock_at: timestamp(now + DAY), status: "Active", transfer_pending: false };
test("import checks authoritative owner, source, asset, status and original maturity", () => {
  assert.equal(assertEligible(position, environment.vault, position.owner_id, environment, now).source_id, environment.vault);
  for (const invalid of [null, { ...position, owner_id: "bob.test.near" }, { ...position, adapter_version: "unknown" }, { ...position, asset_id: "other-token.test.near" }, { ...position, status: "Redeemed" }, { ...position, transfer_pending: true }, { ...position, unlock_at: timestamp(now) }]) assert.throws(() => assertEligible(invalid, environment.vault, position.owner_id, environment, now));
  assert.throws(() => assertEligible(position, "unverified-source.test.near", position.owner_id, environment, now));
});
