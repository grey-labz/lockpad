# Lockpad

**Liquidity for locked positions.**

Lockpad is a place on NEAR where you can borrow against an eligible locked position or sell its future payout. It helps you get funds before the position reaches maturity.

You receive an immediate quote from a funded lending pool. If the borrowing amount does not meet your needs, you can list the position on the marketplace at a price you choose.

## How it works

1. **Choose a position.** Review its locked payout and maturity date.
2. **Review the quote.** See how much you can borrow, the fee and when repayment is due.
3. **Borrow or sell.** Accept the loan, or set an asking price and wait for a buyer.
4. **Complete the position.** Repay to recover your original position. After a sale, the buyer receives the payout at its original maturity.

The principal stays locked at its source. Listing a position earns no proceeds until a buyer completes the purchase.

## Where it is today

The working demo shows borrowing, repayment, sales and maturity payouts on NEAR, with transaction records for each step. It uses local contracts, fixed payout test positions and tokens with no monetary value.

External DEX integrations and a mainnet launch are planned next steps. Positions that cannot transfer their payout right need a supported integration before they can be used.

[Watch the demo](https://github.com/grey-labz/lockpad/releases/download/hackathon-prototype-2026-11-13/lockpad-demo.mp4) · [Try the prototype](docs/SETUP.md) · [Build notes](HACKATHON.md)

Built at NEAR HACKATHON by [Greylabs](https://github.com/grey-labz). Tracks: **Unstoppable DeFi** and **NFTs That Do Something**.
