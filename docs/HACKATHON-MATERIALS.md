# Lockpad: idea → build → demo

## Idea

A person needs liquidity while their position is still locked. Lockpad offers a funded-pool borrowing quote; if the amount does not suit them, they can choose a marketplace sale price instead. Both paths require enforceable control of the payout right, so account-bound positions remain unsupported until a verified adapter or beneficiary mechanism exists.

## Build

Four actual NEAR contracts implement a reference vault, funded lending pool, payout-right marketplace and zero-value TUSD token. A 1,000 TUSD fixed payout produces an illustrative 650 loan and 663 repayment quote. Repayment returns the original NFT; an unpaid loan can settle at original maturity, keeping the amount due and crediting the remaining payout to its borrower. A sale transfers the original NFT before crediting the seller's withdrawable proceeds. The principal remains in the reference vault.

The app uses the supplied black-and-green palette and includes borrowing quotes, repayment, the sale alternative, market search and filters, position details, source eligibility, wallet balances, seller withdrawals, maturity claims and native receipts. Saved evidence records 42 unit cases, 26 lending behaviors and 20 browser behaviors across desktop, tablet and small mobile layouts. The video recording independently checks exact loan, repayment, sale and payout amounts.

Only the fixed-payout reference vault is integrated. The [research](research/near-dex-position-transferability-2026-11-13.md) recommends Rhea DCL NFTs for an initial adapter and identifies Rhea/Jumbo MFT shares as further candidates. Spin vault shares need additional operational and redemption checks. Existing account-bound Rhea locks are not importable simply by wrapping a receipt. DEX collateral valuation and adapter implementation remain proposed work before mainnet.

## Demo — two-minute narrated walkthrough

| Chapter | Actual app behavior |
| --- | --- |
| Idea | A supported position offers borrow or sell choices. |
| Build | Alice's 1,000 TUSD source payout and the four-contract prototype. |
| Quote | Immediate 650 TUSD offer, 2% one-time fee and 663 due. |
| Borrow | The payout NFT secures the loan; 650 reaches Alice's wallet. |
| Repay | Alice pays 663 and recovers the same NFT and original maturity. |
| List | Alice chooses a 920 sale price; a buyer is required. |
| Buy | Bob reviews, funds and receives the original payout NFT. |
| Seller payment | Alice withdraws the actual 920 TUSD proceeds. |
| Maturity | Local Sandbox time advances; the original timestamp is unchanged. |
| Payout | Bob receives the full 1,000 TUSD and the position is redeemed. |
| Receipts | Confirmed local actions and the proposed scope before mainnet. |

The video carries a persistent **LOCAL NEAR SANDBOX · ZERO-VALUE TUSD** disclosure. Actors are temporary builder-controlled accounts. The time advance is explicitly labelled. This is actual local contract execution; it is not evidence of public activity or independent adoption.

The export is [lockpad-demo.mp4](../demo-video/renders/lockpad-demo.mp4); the editable HyperFrames project, capture assertions and delivery evidence are in `demo-video/`. Narration uses the previously authorized ElevenLabs Jack John voice. The earlier 90-second resale draft is preserved under `demo-video/archive/resale-v1/`.

## Submit

Use https://github.com/grey-labz/lockpad as the source URL and the [ready description and X draft](../SUBMISSION.md). The user publishes the video on X, then enters their personal fields, team size, mainnet prize account, chosen tracks, consent and public demo-post URL at https://nearhackathon.com/#apply. No personal fields or application are submitted by the preparation tools.

The saved organizer Q-012 permits this local-only path; public testnet deployment and publicly seeded positions are optional. The recorded deadline is **14 November 2026 at 23:59 UTC**, or **15 November at 00:59 Lagos**. Recheck live rules, confirm existing entries, and submit only once.
