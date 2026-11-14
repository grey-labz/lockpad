# Lockpad hackathon work

Lockpad is a borrow-or-sell prototype for supported locked positions on NEAR. The user approved immediate funded-pool quotes, a marketplace alternative, and the palette `#020202`, `#0d2818`, `#04471c`, `#058c42`, `#16db65`. The [rebuild scope](docs/REBUILD.md) supersedes the earlier teal, sale-only implementation plan.

The build contains four NEAR contracts and a working local app. The two-minute narrated walkthrough follows one position through the quote, borrowing, repayment, listing, purchase, seller withdrawal, original maturity, buyer payout and receipts. The [materials](docs/HACKATHON-MATERIALS.md), [judge guide](docs/SETUP.md), [architecture](docs/ARCHITECTURE.md), [DEX research](docs/research/near-dex-position-transferability-2026-11-13.md) and [submission copy](SUBMISSION.md) describe the same scope.

Source destination: https://github.com/grey-labz/lockpad, using the user's GreyLabs GitHub instruction. The original `greyw0rks/timeshift` history remains the development baseline; the new repository preserves that history. The current work does not deploy contracts to a public network. Third-party adapters and production collateral valuation remain proposals.

Primary suggested track: Unstoppable DeFi (`defi`), with NFTs That Do Something (`nfts`) as an additional fit. AI and NEAR Intents are not integrated.

The organizer's [saved rules](docs/evidence/hackathon-rules-2026-11-13.md) allow a local-only demo with public reproducible source and a human-published X video (Q-012). The user will enter personal, team and prize-account details and publish the demo post. No application is sent by this preparation. The recorded deadline is **14 November 2026 at 23:59 UTC**, or **15 November at 00:59 Lagos**. Recheck the live rules before submitting, submit once, and disclose independent existing entries; one person may submit at most two.

The earlier three-contract [testnet release procedure](docs/RELEASE.md) is retained for reference. It does not deploy or verify the new lending pool and is not the current hackathon delivery path.

## Build notes

The app uses React, Vite, NEAR Connect and near-api-js. The contracts use NEAR SDK and NEAR's token standards, with near-workspaces and Playwright for local verification.

The work extends the earlier [TimeShift baseline](https://github.com/greyw0rks/timeshift/commit/cb4097c1249052d2f8940d9c88969b99023e98c1). The [hackathon comparison](https://github.com/grey-labz/lockpad/compare/cb4097c1249052d2f8940d9c88969b99023e98c1...main) preserves that history. [Greed Machine](https://github.com/greyw0rks/greed-machine) is a separate project by the same builder.
