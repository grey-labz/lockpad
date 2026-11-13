import { DAY, timestampMs } from "./amounts.mjs";

export function selectListings(listings, { query = "", maturity = "all", discount = "all", sort = "maturity", now = Date.now() } = {}) {
  const text = query.trim().toLowerCase();
  const minimum = discount === "all" ? 0 : Number(discount);
  return listings.filter(listing => {
    if (listing.status !== "Open" || timestampMs(listing.unlock_at) <= now) return false;
    const remaining = timestampMs(listing.unlock_at) - now;
    if (maturity === "week" && remaining > 7 * DAY) return false;
    if (maturity === "month" && (remaining <= 7 * DAY || remaining > 30 * DAY)) return false;
    if (maturity === "later" && remaining <= 30 * DAY) return false;
    if ((BigInt(listing.payout) - BigInt(listing.price)) * 100n < BigInt(minimum) * BigInt(listing.payout)) return false;
    return !text || [listing.source_id, listing.token_id, listing.seller_id, `position ${listing.token_id}`, "reference vault", "tusd"].some(value => String(value).toLowerCase().includes(text));
  }).sort((a, b) => {
    if (sort === "discount") {
      const difference = (BigInt(b.payout) - BigInt(b.price)) * BigInt(a.payout) - (BigInt(a.payout) - BigInt(a.price)) * BigInt(b.payout);
      if (difference) return difference > 0n ? 1 : -1;
    } else if (sort === "price" && a.price !== b.price) return BigInt(a.price) < BigInt(b.price) ? -1 : 1;
    return timestampMs(a.unlock_at) - timestampMs(b.unlock_at) || Number(BigInt(a.id) - BigInt(b.id));
  });
}

export function assertEligible(position, sourceId, accountId, environment, now) {
  if (!position) throw new Error("This source has no position with that ID.");
  if (sourceId !== environment.vault || position.adapter_version !== "lockpad-reference-v1" || position.asset_id !== environment.token) throw new Error("This payout right is not supported by the configured marketplace.");
  if (position.owner_id !== accountId) throw new Error("The connected account does not own this payout right.");
  if (position.status !== "Active" || position.transfer_pending) throw new Error("This position is settling or has already been redeemed.");
  if (timestampMs(position.unlock_at) <= now) throw new Error("This position has matured. Claim its payout in My positions.");
  return { ...position, source_id: sourceId };
}
