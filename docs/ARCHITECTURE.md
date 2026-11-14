# Borrowing and payout-right settlement

The source vault holds principal throughout a sale. The marketplace trades an executable NEP-171 payout NFT and holds purchase funding, not the locked principal.

The same NFT can secure a loan from a separate funded pool. Source ownership determines whether it is available to borrow against or sell; the owner cannot use collateral held by the pool to create a marketplace listing.

| Component | Responsibility |
| --- | --- |
| `contract/` | Reference source: test principal deposit, fixed maturity, transferable payout NFT, current-owner redemption. No yield strategy. |
| `marketplace/` | Frozen token/source allowlist, checked listing intake, NFT escrow, separate buyer funding, delivery, seller proceeds, withdrawals and timed delivery reconciliation. |
| `lending/` | Funded-pool quotes, source-checked payout-NFT collateral, reserved disbursement, exact repayment, NFT return, maturity settlement and withdrawable borrower surplus. |
| `token/` | Uncapped, zero-value TUSD test faucet with NEP-141 transfers and registration. |
| `src/hooks/use-lockpad.js` | Verified chain reads, wallet-scoped state, quote checks, explicit multi-step actions and receipt journal. |
| `scripts/demo-server.mjs` | Loopback-only adapter to real temporary Sandbox signers; allowlisted methods and deposits, same-origin writes, bounded request bodies and serialized local transactions. |

## Borrowing and repayment

The local pool is funded with actual zero-value test tokens by its configured funder. Its quote is bounded by available liquidity and an illustrative 65% of a fixed source payout. A one-time 2% fee makes a 650 TUSD loan repayable for 663 TUSD before original maturity. These terms do not value an external DEX position and are not production lending rates.

The owner prepays loan storage and sends the payout NFT with `nft_transfer_call`. The pool verifies the allowlisted source, prior owner, principal, maturity, token and quote. Accepted collateral reserves existing liquidity; the borrower then draws the actual loan payment. A failed payment preserves undrawn collateral and reserved liquidity for recovery. An undrawn loan can be cancelled.

Repayment must cover the exact amount due and come from the borrower before maturity. Short, duplicate, foreign-account or late repayments return the transferred tokens. The borrower separately releases the same NFT after repayment. Source transfer receipts and their deadlines permit reconciliation of an uncertain NFT return.

At maturity, an unpaid loan can claim the original source payout. The pool retains the loan and fee, credits the remainder to the borrower, and permits a separate surplus withdrawal. The 1,000 TUSD example retains 663 and returns 337. Repeated drawing, repayment, settlement and surplus withdrawal cannot pay twice.

At completed receipt boundaries, the pool invariant is `pool FT balance = available liquidity + reserved loans + borrower surplus + pending withdrawals`. The 26-behavior lending suite checks actual payments, rejected collateral reuse, repayments, settlement, surplus, failed disbursement and solvency. The browser and recording verify the borrow → repay → sell journey.

## Listing and purchase

The owner prepays a listing credit, then sends the source NFT with `nft_transfer_call`. The market checks source, prior owner, adapter version, token, principal, status and original maturity. Unsupported or invalid positions return to the owner instead of activating a listing.

Buyer funding is a separate, synchronous credit to an existing market account. `buy` checks the listing quote, remaining maturity, buyer identity and available credit. It reserves the price before requesting NFT delivery. A successful delivery changes the listing to Sold and credits seller proceeds. A confirmed failed delivery restores buyer credit. It does not credit the seller while ownership is uncertain.

The reference source records each expiring transfer attempt. Missing or malformed delivery results leave the purchase reserved. After the deadline, `reconcile` checks the originating source's durable transfer result and settles or restores funds. An expired transfer can no longer deliver late. Cancellation uses the same return/reconciliation mechanism.

At completed receipt boundaries, the solvency invariant is `market FT balance = available balances + seller proceeds + reserved purchases + pending withdrawals`. Both contract and browser checks inspect it. During an in-flight withdrawal, an already-delivered token transfer can precede its accounting callback.

## Wallet and receipt behavior

The UI separates review from confirmation. An in-memory action guard prevents duplicate starts. Each transaction step checks the current account, and public wallet signing checks that the requested signer remains connected. Portfolio results carry their account owner and generation so an old account's balances cannot be presented as a new account's balances.

The journal records intent before signing and associates each step with its own hash. A sent transaction whose RPC confirmation is unavailable keeps its hash for inspection. A returned or partially accepted FT deposit cannot authorize a purchase. Checking a receipt is read-only; reloading never replays a transaction. Purchase funding retries use the latest market balance so an already-confirmed deposit is not blindly repeated.

## Limits

Only the separate reference vault adapter is supported. No Rhea, Shardpad, NEAR Intents or AI integration is claimed. Ordinary token-transfer failure restores a withdrawal balance or active maturity claim. An arbitrary failure of the withdrawal/redemption callback can leave that operation pending; there is no automatic recovery for that case. Source delivery reconciliation is a separate mechanism.

External DEX adapters are proposals supported by [transferability research](research/near-dex-position-transferability-2026-11-13.md). Variable LP and vault-share collateral needs asset valuation, fee treatment and verified recipient redemption; the fixed-reference principal cannot serve as its price oracle. The lending pool has a configured funder and does not implement a public lender-deposit/share market. Its uncertain maturity payout and NFT return have reconciliation paths; arbitrary surplus-withdrawal callback failure can still leave a pending balance.

The contracts are unaudited, retain deployment keys, charge nonrefundable storage, and contain no buyer-demand guarantee. Market and owner reads are limited to the first 100 returned records. Browser actors and time advancement are local test fixtures, not public-network wallet acceptance or independent adoption.
