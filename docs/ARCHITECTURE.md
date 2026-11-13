# Payout-right settlement

The source vault holds principal throughout a sale. The marketplace trades an executable NEP-171 payout NFT and holds purchase funding, not the locked principal.

| Component | Responsibility |
| --- | --- |
| `contract/` | Reference source: test principal deposit, fixed maturity, transferable payout NFT, current-owner redemption. No yield strategy. |
| `marketplace/` | Frozen token/source allowlist, checked listing intake, NFT escrow, separate buyer funding, delivery, seller proceeds, withdrawals and timed delivery reconciliation. |
| `token/` | Uncapped, zero-value TUSD test faucet with NEP-141 transfers and registration. |
| `src/hooks/use-lockpad.js` | Verified chain reads, wallet-scoped state, quote checks, explicit multi-step actions and receipt journal. |
| `scripts/demo-server.mjs` | Loopback-only adapter to real temporary Sandbox signers; allowlisted methods and deposits, same-origin writes, bounded request bodies and serialized local transactions. |

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

The contracts are unaudited, retain deployment keys, charge nonrefundable storage, and contain no buyer-demand guarantee. Market and owner reads are limited to the first 100 returned records. Browser actors and time advancement are local test fixtures, not public-network wallet acceptance or independent adoption.
