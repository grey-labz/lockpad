import { U128_MAX } from "./amounts.mjs";

export function loanMath(principal, amount, { ltvBps = 6500, feeBps = 200, liquidity = U128_MAX.toString() } = {}) {
  const collateral = BigInt(principal), borrowed = BigInt(amount), available = BigInt(liquidity);
  if (collateral <= 0n || collateral > U128_MAX || borrowed <= 0n || available < 0n || available > U128_MAX) throw new Error("Enter a positive borrowing amount within the supported range.");
  if (!Number.isInteger(ltvBps) || ltvBps <= 0 || ltvBps > 9500 || !Number.isInteger(feeBps) || feeBps < 0 || feeBps > 500) throw new Error("The borrowing terms are unavailable.");
  const limit = collateral * BigInt(ltvBps) / 10000n;
  const maximum = limit < available ? limit : available;
  if (borrowed > maximum) throw new Error("The borrowing amount exceeds this position’s current offer.");
  const fee = (borrowed * BigInt(feeBps) + 9999n) / 10000n;
  const repayment = borrowed + fee;
  if (repayment > collateral || repayment > U128_MAX) throw new Error("The repayment exceeds the supported collateral payout.");
  return { amount: borrowed.toString(), maximum: maximum.toString(), fee: fee.toString(), repayment: repayment.toString(), surplus: (collateral - repayment).toString() };
}

export function loanState(loan, now) {
  const mature = Number(BigInt(loan.unlock_at) / 1000000n) <= now;
  return { label: ({ CollateralReady: "Ready to borrow", Checking: "Checking collateral", Disbursing: "Payment pending", Active: mature ? "Maturity reached" : "Active loan", RepaymentReady: "Repaid · return pending", Returning: "Returning collateral", Repaid: "Repaid", Cancelled: "Cancelled", Settling: "Payout settling", Settled: "Settled at maturity" })[loan.status] || "Review receipt", mature };
}
