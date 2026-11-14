# Lockpad implementation

Historical resale plan. The current [borrow-or-sell rebuild](REBUILD.md) and [judge guide](SETUP.md) describe the approved green interface, funded lending pool and four-contract demo.

The user approved the centered ChronoTask-inspired hero with floating position cards on 13 November 2026. Final palette: muted teal `#8ab0ab`, charcoal blue `#3e505b`, dark slate grey `#26413c`, carbon black `#1a1d1a`, onyx `#03120e`. The lilac palette and earlier three design directions are superseded.

## Product

An owner can sell the right to a locked payout before maturity. The buyer pays less than the principal and claims the original payout at the original date. Example: a 30-day 1,000-token position sold on day 15 for 920 tokens. The discount is 8%; the buyer's gross return on purchase price is 80/920 = 8.70%. Neither is an annualized yield or a risk-free return.

The first supported source is a separate reference vault contract. It is a test instrument with no yield strategy. Its principal stays in that contract; the marketplace receives only its transferable NEP-171 payout NFT. Integrating Rhea or any other third-party protocol requires proving its specific lock is transferable and adapting its authoritative position data. Account-bound or admin-controlled locks cannot be listed by an ordinary user.

## Contract responsibilities

- `contract/`: separate reference vault. Receives test FT principal, fixes maturity, issues a payout NFT, and redeems to its current owner after maturity.
- `marketplace/`: accepts NFTs only from configured source contracts, validates their owner, principal, payment asset and maturity, then lists them at a discount. Escrows the payout right rather than the underlying principal.
- `token/`: clearly labelled, uncapped testnet-only TUSD faucet token.

Buyer funding is a synchronous FT deposit into a recoverable market balance. Purchase is a separate call that reserves this balance before transferring the NFT. Seller proceeds become withdrawable only after successful NFT delivery. This separation avoids an asynchronous NFT delivery being followed by an automatic FT refund if the settlement callback fails. Pending NFT purchases and cancellations can be reconciled against the originating vault after a timeout. Token payout callbacks restore balances on ordinary transfer failure; arbitrary callback failure remains a documented recovery limitation.

## Application

Centered landing page; real marketplace with search, maturity/discount filters and sort; position detail with a maturity timeline and purchase breakdown; import/list an existing eligible position; owned positions and sale proceeds; receipt history; source eligibility explanation. No fabricated market volume, listings, users, protocol integration or return guarantees.

`npm run demo` runs a local NEAR Sandbox, deploys actual Wasm contracts, creates ephemeral test wallets, seeds real local positions and serves the app. The sandbox is labelled throughout. A separate testnet mode uses NEAR Connect and explicit deployed contract configuration. Local browser tests must execute the full seller → buyer → maturity claim flow against the real local contracts, including the originating vault's ownership and balances.

## Hackathon

Primary track: Unstoppable DeFi (`defi`). An NFT represents an executable payout right, but no AI or NEAR Intents integration is claimed. Official Q-011 says those integrations are optional; Q-010 permits testnet-only projects. Keep a clear baseline diff, reproducible judge guide, MIT license and working demo recording. Development deadline: 14 November 2026 at 23:59 UTC (15 November 00:59 in Lagos).

The original imported repository remains in `outputs/timeshift`. Canonical working root is `/home/greyw0rks/Lockpad`, branch `hackathon/lockpad-resale`, baseline `cb4097c`. Publishing, public-network transactions and submission need the separate confirmations specified by HACKATHON.md.

The user clarified during the 13 November continuation that the hackathon focus is idea, build and demo video. Q-012 permits a local-only working demo with reproducible public source and an X video. Keep one local reference position as the recording's test input. Public marketplace seeding and public testnet deployment are optional, outside the current submission path.
