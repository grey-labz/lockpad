# Lockpad: idea → build → demo

The current hackathon path is a reproducible local build and a working demo video, followed by publication of the source, the human's X demo post, and the confirmed submission. Public demo positions and a public testnet deployment are optional. The organizer's [Q-012](evidence/hackathon-rules-2026-11-13.md) explicitly accepts local-only demos with a public repository, reproducible README and X video; screenshots alone are insufficient when the app cannot be opened.

## Idea

Someone locks funds for 30 days and needs liquidity on day 15. Lockpad lets them sell the right to that future payout at a discount. Selling a 1,000-token payout for 920 gives the seller early liquidity; the buyer receives the original payout right and claims at its original maturity. The principal remains in its source vault throughout the sale.

## What is built

The working prototype has three actual NEAR contracts: a separate reference vault, payout-right marketplace and zero-value test token. The market verifies the source and seller, escrows the payout NFT, accepts recoverable purchase funding, transfers the NFT and releases withdrawable seller proceeds after delivery. The buyer claims from the originating vault after the original maturity.

The app includes the approved teal design, market search and filters, source-checked position details, ownership and balance views, listing, purchase, withdrawal, maturity claim and receipt history. Current checks pass: 35 unit checks, 11 release/receipt checks and 15 browser behaviors. The saved 19-contract-behavior run still matches the unchanged source and Wasm hashes.

Only the reference vault is integrated. It is a test instrument, not a yield strategy. No Rhea or other third-party lock, AI, NEAR Intents, public adoption or guaranteed return is claimed.

## Demo recording outline — about 90 seconds

| Time | Show | Explain |
| --- | --- | --- |
| 0–10 s | Lockpad landing page and illustrative 1,000 → 920 → 1,000 example | “Your funds are locked. Your options aren't. Sell the future payout when you need liquidity early.” |
| 10–20 s | Existing position in My positions, its source and original maturity | “This working build trades the payout NFT. Its principal stays in a separate source vault.” |
| 20–35 s | Seller reviews and lists one local 1,000 TUSD position for 920 TUSD | Show the 8% discount and original maturity. Listing alone earns no sale proceeds. |
| 35–55 s | Switch to the buyer, review and confirm the purchase | Show accepted funding, delivered NFT and its unchanged principal and maturity. |
| 55–65 s | Switch to the seller and withdraw proceeds | Show the seller's actual 920 TUSD token payment and receipt. |
| 65–80 s | Buyer claims after the source's original maturity | Show the actual 1,000 TUSD payout and Redeemed status. Cut the waiting period; if local Sandbox time is advanced, label it explicitly and retain the original source timestamp. |
| 80–90 s | Activity receipts and a final product screen | “A discounted early exit, settled by NEAR contracts. The reference-vault prototype and setup are in the public source.” |

One local test position is the input for this complete demonstration. Keep the Local NEAR Sandbox and zero-value-token labels visible. A fresh one-minute term permits a short real-time recording; the existing five-minute term gives more time for wallet actions. Neither public market seeding nor deployment is needed for this video.

Record actual app behavior. The current preview is `http://127.0.0.1:5273/`; restart with `npm run demo` for fresh temporary wallets. The [judge guide](SETUP.md) contains the exact seller → buyer → claim sequence. This outline is ready; a new demo video has not yet been recorded or uploaded.

## Submission description draft

Lockpad helps owners exit a fixed-maturity payout before its lock expires. An owner lists a supported payout NFT at a discount; a buyer funds the purchase, receives that original NFT and claims its principal at the original maturity. NEAR contracts verify source data and seller authority, deliver the payout right and release seller proceeds after delivery. Principal remains in a separate reference vault. The working local build includes market filters, position details, listing, purchase, withdrawal, maturity claim and receipts. It uses a zero-value test token and a reference source; no third-party DeFi integration or independent adoption is claimed.

Suggested primary track: **Unstoppable DeFi (`defi`)**. The human confirms the final tracks and personal submission fields. Greed Machine is disclosed as a separate project by the same builder. Confirm the person's existing entries because at most two independent projects are allowed.

## X draft — unpublished

> Need your locked funds early? Lockpad lets you sell a future payout at a discount. The local demo shows the NFT sale, seller payment and maturity claim on NEAR. Built at NEAR HACKATHON. @NEARProtocol #NEARHackathon
> https://github.com/greyw0rks/timeshift

Publish the current build before using that source link. The human attaches the working demo video, publishes the post and provides its public URL. Submission requires that URL, the public source, a human-provided mainnet prize account and contact fields, consent, and explicit confirmation of the exact payload. Development and submission end **14 November 2026 at 23:59 UTC**, or **15 November at 00:59 Lagos**.
