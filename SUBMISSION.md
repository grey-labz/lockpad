# Lockpad

Lockpad is a secondary marketplace for fixed-maturity payout rights on NEAR. An owner sells the right to a future payout before its lock expires, while the buyer receives the original payout NFT and claims its principal at the original maturity.

The local MVP uses a separate reference vault, marketplace and zero-value TUSD faucet. The vault retains principal; the market accepts only supported payout rights, verifies seller authority and source data, deposits recoverable purchase funding, delivers the NFT, and releases withdrawable seller proceeds after delivery.

A 1,000-token payout sold for 920 gives the seller early liquidity and the buyer an 8% discount. The buyer's gross difference is 80 tokens, or 8.70% of purchase price, before gas and storage. No annualized yield or guaranteed return is claimed.

Primary track: **Unstoppable DeFi**. The product includes marketplace search and filters, a source-checked maturity timeline, existing-position import and listing, ownership and balance views, sale withdrawals, maturity claims, and transaction receipts. No third-party protocol, AI or NEAR Intents integration is claimed.

Saved checks exercise actual local NEAR contracts: 19 contract behaviors, 35 amount/filter/eligibility/receipt/release checks, and 15 browser behaviors across seven routes and four viewport sizes. The deployment rehearsal additionally checks interrupted deployment recovery, exact code and initializer matching, both token registrations and final-receipt trade verification. Browser tests advance local Sandbox time for maturity and create a controlled cancellation race to verify unused buyer funding recovery. Actors are temporary builder-controlled fixtures; this is not adoption or public-testnet acceptance evidence.

[Judge guide](docs/SETUP.md) · [Architecture and limits](docs/ARCHITECTURE.md) · [Release guide](docs/RELEASE.md)

The earlier [public app](https://greyw0rks.github.io/timeshift/) and [public source](https://github.com/greyw0rks/timeshift) predate this implementation. The new three-contract marketplace is a local, unpublished release candidate. The current hackathon path uses [reproducible source and a working local demo video](docs/HACKATHON-MATERIALS.md), as allowed by Q-012. Current source publication, video upload and submission remain pending; public testnet deployment is optional. Contracts retain upgrade keys and are unaudited; arbitrary withdrawal/redemption callback failure remains a documented recovery limit.
