Lockpad gives the owner of a supported locked position an immediate borrowing quote from a funded lending pool, with a marketplace sale as the alternative. This prototype runs four real NEAR contracts in a local Sandbox using a test token with no monetary value.

The two-minute narrated demo follows one 1,000 TUSD payout right through a 650 TUSD loan, 663 repayment and return of the original NFT, then a 920 sale, buyer delivery, seller withdrawal and 1,000 original-maturity payout. It uses the approved black-and-green palette and existing ElevenLabs Jack John narration. Local time advancement is labelled in the video.

Downloads:

- `lockpad-demo.mp4`: final 120-second, 1080p narrated walkthrough.
- `lockpad-source.zip`: reproducible app, four contracts, Wasm, tests, evidence and documentation.
- `lockpad-demo-editable.zip`: HyperFrames composition, real footage, narration, fonts and export evidence.
- `submission-copy.md`: project description, X post draft and form guidance.
- `lockpad-submission.zip`: complete package with checksums.

Saved checks cover 42 unit cases, 26 lending behaviors, 20 browser behaviors and 11 checks for the earlier optional three-contract release executor. Source and Wasm hashes match those checks. The video passed full audio and video decoding and visual inspection of its decoded chapter frames; narration is measured at −14.1 LUFS with a −1.0 dBFS true peak. It has not received a listening review.

Run the prototype with Node 22.12+: `npm ci --ignore-scripts`, then `npm run demo`. Open http://127.0.0.1:5273 and follow the [judge guide](https://github.com/grey-labz/lockpad/blob/main/docs/SETUP.md).

Only the fixed-payout reference vault is integrated. External DEX adapters, variable collateral valuation and mainnet deployment remain proposed work. The contracts are unaudited and retain upgrade keys. The demo uses temporary builder-controlled accounts.

Built at NEAR HACKATHON. The user publishes the X demo post and enters personal, team and payout fields in the application. Preparing this release does not submit the application.
