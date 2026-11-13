export const DECIMALS = 6;
export const SCALE = 1_000_000n;
export const U128_MAX = (1n << 128n) - 1n;
export const DAY = 86_400_000;

export function toUnits(value, decimals = DECIMALS) {
  const input = String(value).trim();
  if (!new RegExp(`^\\d{1,38}(?:\\.\\d{1,${decimals}})?$`).test(input)) {
    throw new Error(`Enter a positive amount with up to ${decimals} decimal places.`);
  }
  const [whole, fraction = ""] = input.split(".");
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
  if (amount <= 0n || amount > U128_MAX) throw new Error("The amount is outside the supported range.");
  return amount.toString();
}

export function formatAmount(value = "0", decimals = DECIMALS) {
  const amount = BigInt(value);
  if (amount < 0n) throw new Error("Amounts cannot be negative.");
  const scale = 10n ** BigInt(decimals);
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return (amount / scale).toLocaleString("en-US") + (fraction ? "." + fraction : "");
}

function percent(numerator, denominator) {
  const divisor = BigInt(denominator);
  const result = (BigInt(numerator) * 10_000n + divisor / 2n) / divisor;
  return `${result / 100n}.${(result % 100n).toString().padStart(2, "0")}`;
}

export function tradeMath(payout, price) {
  const full = BigInt(payout), cost = BigInt(price);
  if (full <= 0n || cost <= 0n || cost >= full) throw new Error("Sale price must be positive and below the payout.");
  return { profit: (full - cost).toString(), discount: percent(full - cost, full), returnOnPrice: percent(full - cost, cost) };
}

export function timestampMs(nanoseconds) { return Number(BigInt(nanoseconds) / 1_000_000n); }
export function timeLeft(unlockAt, now) {
  const remaining = timestampMs(unlockAt) - now;
  if (remaining <= 0) return "Ready to claim";
  if (remaining >= DAY) return `${Math.ceil(remaining / DAY)} days`;
  if (remaining >= 60_000) return `${Math.ceil(remaining / 60_000)} min`;
  return `${Math.ceil(remaining / 1_000)} sec`;
}

export function maturityDate(unlockAt, full = false) {
  return new Intl.DateTimeFormat("en-US", full ? { dateStyle: "medium", timeStyle: "short" } : { month: "short", day: "numeric", year: "numeric" }).format(timestampMs(unlockAt));
}
