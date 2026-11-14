# Run and verify Lockpad

## Local demo

Use Node 22.12 or newer. Linux x86-64 is the automatic Sandbox installation path; other platforms need a NEAR Sandbox 2.14.1 binary and `LOCKPAD_SANDBOX_BINARY` pointing to that executable.

```sh
npm ci --ignore-scripts
npm run demo
```

The app opens at `http://127.0.0.1:5273`. Set `LOCKPAD_DEMO_PORT` to select another local port. The first run downloads NEAR Sandbox 2.14.1 if it is unavailable; subsequent runs reuse `.demo/bin/near-sandbox`. The `res/` Wasm files are matched against their build manifest and source hashes before deployment. If a contract source changes, rebuild it before running the demo.

The process needs local socket access. In a restricted execution environment, run it with local networking allowed. A preflight now reports denied socket access promptly instead of allowing the dependency's port finder to search indefinitely.

Alice, Bob and Nora are temporary builder-controlled accounts. Alice starts with an existing 1,000 TUSD five-minute position; Bob has 1,000 test tokens; Nora has three listed reference positions. The contracts and transactions are actual local NEAR execution. These fixtures are not public activity or independent adoption. Stop with Ctrl+C; a restart creates a new run and scopes wallet history to its new run ID.

## Borrow → repay, or list instead

1. Choose **Alice**, open **My positions**, and select **Borrow** on her existing 1,000 TUSD reference position. The funded pool shows an immediate **650 TUSD** maximum and **663 TUSD** total due at its original maturity. The 65% limit and 2% one-time fee are illustrative prototype terms.
2. Review and accept the loan. The source NFT moves to the pool as collateral, its principal stays in the vault, and **650 TUSD** reaches Alice's wallet. Check the active loan and its receipts in My positions or Activity.
3. Use **Get test tokens** in My positions if needed so Alice can cover the full repayment including the fee. Repay **663 TUSD** before maturity and release the collateral. The original NFT returns with its unchanged principal and maturity.
4. To choose a sale instead, use **List this position instead** from the borrowing quote, or **Sell** from My positions. A pledged position must be repaid or an undrawn loan cancelled before it can be listed.

If the short seed position has matured while exploring, claim it or create another reference test position. A fresh demo run creates fresh temporary wallets and positions.

## Seller → buyer → maturity

1. Choose **Alice**, open **My positions**, and list her existing payout right for **920 TUSD**. The review shows its 8% discount, 80-token gross difference, and unchanged maturity. If the short seed lock has already matured, claim it or use the faucet and create a new reference test position.
2. Choose **Bob**, open Alice's listing in **Marketplace**, and review the purchase. Confirming deposits only the funding shortfall into Bob's recoverable market balance, then purchases the payout NFT. A review alone sends nothing.
3. Choose **Alice** and withdraw the **920 TUSD** in sale proceeds. Listing alone does not earn proceeds.
4. Choose **Bob** and claim the full **1,000 TUSD** after the source's original maturity. The **Create test position** dialog also offers a one-minute term for a shorter walkthrough.
5. Open **Activity** to inspect each transaction receipt and the completed source transfer. The local run's receipt endpoint exports the current run without private keys.

**How it works** explains source eligibility and risks. **Sell a position** also checks a position ID directly against the configured source and connected owner. Matured, redeemed, foreign-owned and unsupported rights are rejected.

## Rebuild and checks

The repository pins Rust 1.99.1, `rust-src`, the Wasm target, NEAR SDK 5.28.0 and Sandbox 2.14.1. The build uses Wasm MVP and `build-std` because an ordinary modern Wasm build can contain instructions the NEAR runtime rejects.

```sh
npm test
npm run contracts:build
npm run test:contracts
npm run test:lending
npm run test:release
npx playwright install chromium
npm run build
npm run test:e2e
```

`npm run verify` runs the project checks together; install Chromium once beforehand. Contract checks use real transactions and the original one-minute maturity. Browser checks use actual local contracts, not mocked payment results. They advance only the local Sandbox by 600 blocks to test the maturity claim; the original maturity is never rewritten. A controlled seller cancellation between deposit and purchase verifies recoverable buyer funding.

Evidence is saved in `docs/evidence/contract-build.json`, `contract-tests.json`, `lending-tests.json`, `browser-tests.json`, and `browser-receipts.json`. Screenshots cover desktop, tablet and small mobile layouts. The production build is also served beneath `/timeshift/` to check relative JavaScript, font and icon paths. An unconfigured production build exposes no sample trades or signing controls. The saved 42 unit, 26 lending and 20 browser cases cover the revised borrow-or-sell build; the release rehearsal below covers only the earlier three-contract testnet executor.

## Public testnet mode

`npm run dev:testnet` uses NEAR Connect rather than the temporary local wallet chooser. Set `VITE_TOKEN_ACCOUNT`, `VITE_VAULT_ACCOUNT`, `VITE_MARKET_ACCOUNT`, optionally `VITE_POOL_ACCOUNT`, and `VITE_NEAR_RPC` using `.env.example`. The app verifies contract versions, token, decimals and configured sources before enabling writes. Borrowing remains unavailable without a verified configured pool.

The revised four-contract system has not been deployed to public testnet. The [release guide](RELEASE.md) retains an offline plan, read-only preflight, the earlier three-contract executor, independent deployment verification and actual-wallet acceptance. That optional executor does not deploy or verify the lending pool. Deployment requires an existing plan and `--execute`; ordinary plan and verification commands do not sign. The hackathon uses the reproducible local app and video instead.

`npm run test:release` checks the actual deployment path in a separate local Sandbox. It simulates a lost response after broadcasting the first real deployment, resumes from that exact receipt, and confirms there are only five deployment/registration signatures. It then checks the seller → buyer → payout flow through the same read-only verifier used for public wallet acceptance. Final receipts precede the state snapshot; local Sandbox time advancement preserves the source's original maturity.

For the current local-only submission, run `npm run submission:bundle`. It packages current source, the final video and submission copy, verifies saved source/artifact hashes and delivery evidence, and performs no network writes. The earlier `release:bundle` command is for the three-contract testnet plan and is not used for this prototype.
