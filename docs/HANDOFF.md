# Lockpad handoff

Canonical workspace: /home/greyw0rks/Lockpad. The project extends the existing TimeShift history; preserve that history and the archived 90-second resale draft.

The approved product gives an owner of a supported locked payout right an immediate quote from a funded lending pool, with a marketplace sale as the alternative. The user selected the palette #020202 / #0d2818 / #04471c / #058c42 / #16db65. Four actual NEAR contracts separate the reference vault, funded pool, marketplace and zero-value TUSD.

The local prototype quotes 650 against a fixed 1,000 payout, with a one-time 2% fee and 663 due before original maturity. Repayment returns the same NFT. An unpaid loan can settle at maturity, retaining 663 and crediting the remaining 337 to the borrower. A sale can deliver the original NFT to a buyer, release 920 seller proceeds and permit the buyer's 1,000 original-maturity payout. These are illustrative fixed-payout terms, not production DEX valuation.

Current source locations: lending/, src/borrow.jsx, src/lib/lending.mjs and src/theme.css, plus the existing source vault, marketplace and token. Saved current evidence covers 42 unit cases, 26 lending behaviors and 20 browser behaviors; source/artifact hashes are checked before packaging. The separately saved 11-case release rehearsal covers only the historical three-contract testnet executor. Do not use it as proof of a public lending-pool deployment.

The narrated video is 120 seconds, 1920 × 1080, 30 fps, with eleven chapters and the existing ElevenLabs Jack John voice. capture-borrow.json records actual isolated local Sandbox actions and receipts. voice-borrow.json retains word alignment; timing.json and the eleven compositions define the edit. The final check has no errors or warnings. REVIEW.md records visual review, a final 663 repayment-title fix and the brief native quote scroll retained for truthful app footage. Audio is measured, not listening-reviewed. The earlier film is in demo-video/archive/resale-v1/.

The source destination is https://github.com/grey-labz/lockpad, using the user's GreyLabs GitHub instruction. Video and editable assets are release downloads; generated media is excluded from Git. npm run submission:bundle verifies current source/artifacts and export evidence, then packages the source, MP4, editable project and submission copy without network writes.

The user will enter personal, team and prize-account fields and publish the X demo post. SUBMISSION.md contains a 923-character description, a 249-weighted-character X draft with the required statement and tags, source URL and form link. No application or X post is sent by preparation. Recheck the live rules and avoid resubmitting an existing project. The recorded deadline remains 14 November 2026 at 23:59 UTC, or 15 November at 00:59 Lagos.

DEX transferability research recommends Rhea DCL NFT custody as the first adapter candidate, then Rhea/Jumbo MFT shares. Spin vault shares need additional operational and recipient-redemption checks. Existing account-bound Rhea locks cannot be imported simply by wrapping a displayed receipt. Only the fixed-payout reference source is implemented; DEX adapters, variable collateral valuation and mainnet remain proposed work.

Run npm ci --ignore-scripts and npm run demo with Node 22.12+. The judge guide explains the borrow → repay → sell → buyer payout journey. Demo accounts and tokens are temporary local fixtures. No public-network transaction is necessary for the organizer's Q-012 local-only path.
