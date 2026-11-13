# Release Lockpad

The current release candidate is local. The reviewed [deployment plan](evidence/release-plan.json) targets a new test token, separate reference vault and marketplace. The existing [public repository](https://github.com/greyw0rks/timeshift) and [Pages app](https://greyw0rks.github.io/timeshift/) still contain baseline `cb4097c1249052d2f8940d9c88969b99023e98c1`.

| Role | Proposed testnet account | Fresh-account funding reserve |
| --- | --- | --- |
| Test token | `lockpad-tusd-261113.testnet` | 4.09681 test NEAR |
| Reference vault | `lockpad-vault-261113.testnet` | 7.71404 test NEAR |
| Marketplace | `lockpad-market-261113.testnet` | 6.77605 test NEAR |

The 18.58690 test NEAR total reserves Wasm storage plus 1 test NEAR per account for state and gas; it is not a fixed fee. A faucet-funded 10 test NEAR in each account covers this reserve. Both vault and market register with the token using its exact `storage_balance_bounds.min`, capped at 0.03 test NEAR each. The account IDs were absent at the recorded [read-only preflight](evidence/testnet-preflight.json); inspect them again immediately before account creation.

## Review and authorize

The [organizer instructions](evidence/hackathon-rules-2026-11-13.md), under “Never without the human's explicit confirmation,” say:

> Make the repository public, push, or force-push.
>
> Sign transactions, spend tokens or deploy to mainnet.

The approved implementation plan also reserves separate confirmation for public-network transactions. The next approval covers creating these three fresh testnet accounts, deploying the reviewed Wasm and its exact initializers, making both token registrations, and publishing this reviewed source and Pages build. Submission remains a separate exact-payload confirmation. Local Sandbox checks and package preparation are complete before asking for that release approval.

## Prepare and deploy

These commands prepare a plan offline and inspect accounts without signing:

```sh
npm run release:plan -- lockpad-tusd-261113.testnet lockpad-vault-261113.testnet lockpad-market-261113.testnet --out .release/lockpad-20261113
npm run release:preflight -- --plan .release/lockpad-20261113/plan.json
```

After the release is explicitly approved, set `LOCKPAD_TESTNET_KEYS` to a private directory outside the repository and create the accounts:

```sh
npm run release:account -- lockpad-tusd-261113.testnet --execute
npm run release:account -- lockpad-vault-261113.testnet --execute
npm run release:account -- lockpad-market-261113.testnet --execute
npm run release:preflight -- --plan .release/lockpad-20261113/plan.json
npm run release:deploy -- --plan .release/lockpad-20261113/plan.json --execute
npm run release:verify -- .release/lockpad-20261113/plan.json .release/lockpad-20261113/verification.json
```

The executor deploys token `new({})`, vault `new({asset_id: token})`, and market `new({asset_id: token, source_ids: [vault]})`. It records each signed hash before broadcast. If confirmation is unavailable, it stops. Resuming first checks every recorded receipt and sends only steps that have never been signed. Failed or unknown receipts stop the release; an existing contract outside this journal is never overwritten. Independent verification reads code hashes, versions, assets, the exact source allowlist, token precision and both registrations at one final block.

## Publish the app

After the approved deployment passes verification, set these **repository variables** in `greyw0rks/timeshift`: `VITE_TOKEN_ACCOUNT`, `VITE_VAULT_ACCOUNT`, `VITE_MARKET_ACCOUNT`, and `VITE_NEAR_RPC`, using the plan's public frontend values. No private deployment key belongs in GitHub Pages configuration.

The Pages workflow runs the unit checks, verifies the deployed contracts, and builds the matching testnet app. It publishes the verification at `/timeshift/release.json`. Missing configuration or a code/configuration/registration mismatch fails the build. For a local production build with those public environment values, run `npm run release:build`.

Publish `hackathon/lockpad-resale` for the [baseline diff](https://github.com/greyw0rks/timeshift/compare/cb4097c1249052d2f8940d9c88969b99023e98c1...hackathon/lockpad-resale), then update `main` only through the approved publication step. The compare URL becomes available after the branch is pushed. Recheck remote `main` first and preserve any intervening changes.

## Accept with actual testnet wallets

Use two distinct human-operated testnet wallets for the first acceptance. Each needs gas and storage funding. Through the published app, the seller creates a reference position, lists its 1,000 TUSD payout for 920 TUSD, the buyer purchases it, the seller withdraws the agreed proceeds, and the buyer claims at the source's original maturity. A one-minute test term shortens this demonstration. Retain the five transaction hashes from Activity.

The read-only trade verifier accepts a JSON proof with `releaseId`, `listingId`, `sellerId`, `buyerId`, and `transactions` containing `listing`, `funding`, `purchase`, `withdrawal`, and `redemption` hashes. This initial acceptance uses a fresh buyer deposit equal to the price and one isolated seller payout. Run:

```sh
npm run release:trade -- .release/lockpad-20261113/plan.json .release/lockpad-20261113/trade-proof.json .release/lockpad-20261113/trade-verification.json
```

It waits for final receipts before taking a source snapshot, checks the original NFT, payout and maturity, and confirms the exact token transfer events for seller and buyer. It never signs or repeats a trade. Builder-controlled fixtures establish implementation behavior; they do not establish independent adoption.

## Package and submit

`npm run release:bundle -- .release/lockpad-20261113/plan.json` creates source and configured static-site ZIPs, a source/artifact verification summary, and exact archive/file hashes. It refuses stale or failed unit, release or browser evidence. This package is unpublished; the offline site does not establish a public deployment.

The live rules were checked on 13 November: development and submission end **14 November 2026 at 23:59 UTC**, or **15 November at 00:59 Lagos**. The human publishes the working demo on X, stating it was built at NEAR HACKATHON and including `@NEARProtocol` and `#NEARHackathon`. Before submission, confirm the person's existing entries, the independent-project disclosure, mainnet prize account, contact details, tracks, demo URL and consent. One person may submit at most two independent projects. Never resend an already submitted repository; corrections use the organizer's Request changes page.
