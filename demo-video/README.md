# Lockpad narrated demo

120 seconds, 1920 × 1080, 30 fps. Eleven chapters follow real app footage: the borrow-or-sell idea, the four-contract build, the 650 TUSD quote and 663 repayment, actual borrowing, return of collateral, a 920 sale, buyer delivery, seller withdrawal, original maturity, 1,000 payout and receipts.

The footage uses an isolated local NEAR Sandbox, temporary builder-controlled accounts, a fixed-payout reference vault and zero-value TUSD. The original maturity remains unchanged when local time advances. External DEX adapters and production lending terms are proposed work before mainnet.

The export is `renders/lockpad-demo.mp4`. The editable bundle is `renders/lockpad-demo-editable.zip`; download it from the [GreyLabs release](https://github.com/grey-labz/lockpad/releases/tag/hackathon-prototype-2026-11-13) to obtain the footage, narration, fonts and GSAP assets omitted from Git. Extract it, then use Node 22+, FFmpeg and Chromium:

```sh
npm run dev
npm run check
npm run render -- --quality delivery --video-frame-format png -o renders/lockpad-demo.mp4
```

The commands pin HyperFrames 0.9.30. The HyperFrames desktop app can also edit the composition. Rendering uses the existing ElevenLabs Jack John voice tracks and needs no API key or additional voice generation.

To rebuild the edit from the captured footage, run `node build.mjs`. The script uses `narration-borrow.json`, `voice-borrow.json` and `capture-borrow.json` to produce `timing.json`, `index.html` and the eleven scene files. Capturing another app run requires the full Lockpad source. Generating a new narration requires the user-provided `ELEVENLABS_API_KEY` environment variable.

The original 90-second resale draft is preserved locally in `archive/resale-v1/`. Current review, full-decode checks, audio measurements and export hashes are in `REVIEW.md` and `evidence/`.
