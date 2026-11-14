# Lockpad

Lockpad gives an owner of a supported locked position two ways to get liquidity before maturity: borrow against it from a funded pool, or list its payout right for sale at a chosen price.

For the prototype's fixed 1,000 TUSD payout, the pool quotes 650 TUSD with 663 due before maturity. Repayment returns the original position. If that offer is too low, the owner can list for 920 TUSD instead; a buyer must accept the price. These are illustrative terms using a test token with no monetary value.

Four working NEAR contracts separate the reference vault, funded lending pool, marketplace and test token. Principal stays in the source vault. The payout NFT secures a loan or moves to the buyer after a sale. A position cannot be pledged and sold simultaneously.

With Node 22.12+:

```sh
npm ci --ignore-scripts
npm run demo
```

Open `http://127.0.0.1:5273`. Choose Alice, open **My positions**, then **Borrow** to see the pool quote. Accept and repay to recover the position, or use **List this position instead**. Switch to Bob to buy, then Alice to withdraw the proceeds. After the original maturity, Bob claims the payout. The [judge guide](docs/SETUP.md) explains each step and verification.

The demo runs actual contracts in an isolated local NEAR Sandbox with temporary wallets. The [two-minute narrated video](https://github.com/grey-labz/lockpad/releases/download/hackathon-prototype-2026-11-13/lockpad-demo.mp4) shows borrowing, repayment, sale, seller payment, maturity payout and receipts. Local time advancement is explicitly labelled. Saved checks cover 42 unit cases, 26 lending behaviors and 20 browser behaviors with no browser errors.

Only the fixed-payout reference vault is integrated. [NEAR DEX research](docs/research/near-dex-position-transferability-2026-11-13.md) identifies Rhea DCL NFTs and transferable Rhea/Jumbo LP shares as adapter candidates. An account-bound lock cannot become transferable collateral simply by wrapping its displayed receipt. DEX adapters, variable-asset valuation and mainnet deployment remain proposed work. The contracts are unaudited and retain upgrade keys; [architecture and limits](docs/ARCHITECTURE.md) describes recovery constraints.

[Hackathon materials](docs/HACKATHON-MATERIALS.md) · [Submission copy](SUBMISSION.md) · [Source](https://github.com/grey-labz/lockpad)

Built at NEAR HACKATHON. The work extends the earlier [TimeShift baseline](https://github.com/greyw0rks/timeshift/commit/cb4097c1249052d2f8940d9c88969b99023e98c1); [review the hackathon changes](https://github.com/grey-labz/lockpad/compare/cb4097c1249052d2f8940d9c88969b99023e98c1...main). It uses React, Vite, NEAR SDK and contract standards, NEAR Connect and near-api-js, with near-workspaces and Playwright for verification. [Greed Machine](https://github.com/greyw0rks/greed-machine) is a separate project by the same builder.
