# Lockpad

Your funds are locked. Your options aren't.

Lockpad lets an owner sell a fixed-maturity payout right before its lock expires. A buyer pays less than the principal and claims the original payout at the original date. Selling a 1,000-token payout for 920 gives the seller an early exit and the buyer an 8% discount; the buyer's gross difference is 80 tokens, or 8.70% of the purchase price, before gas and storage.

The working local prototype uses three actual NEAR contracts: a separate reference vault, a payout-right marketplace, and a clearly labelled test token. Principal stays in its vault. The market escrows its NFT, delivers it to the buyer, and releases withdrawable seller proceeds after delivery. Unused buyer funding can be withdrawn.

Run with Node 22.12 or newer:

```sh
npm ci --ignore-scripts
npm run demo
```

Open `http://127.0.0.1:5273`. The local NEAR Sandbox creates temporary test wallets and real local positions. No public-network transactions or valuable tokens are used.

[Setup and judge guide](docs/SETUP.md) · [Contract architecture](docs/ARCHITECTURE.md) · [Release plan](docs/RELEASE.md)

Only the reference vault is integrated. Rhea and other third-party DeFi locks require a verified source adapter. This is an unaudited prototype with retained upgrade keys and documented callback recovery limits.

The [earlier public release](https://greyw0rks.github.io/timeshift/) and [public repository](https://github.com/greyw0rks/timeshift) predate this local implementation. The new three-contract marketplace has not been published or deployed to public testnet.

The NEAR HACKATHON work is on `hackathon/lockpad-resale`, starting from [baseline cb4097c](https://github.com/greyw0rks/timeshift/commit/cb4097c1249052d2f8940d9c88969b99023e98c1). It adds separate-source custody, NFT settlement, recoverable funding and a new marketplace UI; the [release guide](docs/RELEASE.md) identifies the review diff. It uses React, Vite, NEAR SDK and contract standards, NEAR Connect and near-api-js, with Sandbox, near-workspaces and Playwright for verification. [Greed Machine](https://github.com/greyw0rks/greed-machine) is a separate project by the same builder.
