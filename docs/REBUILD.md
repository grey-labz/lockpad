# Lockpad: borrow or sell

The revised product gives a locked-position owner two ways to seek liquidity before maturity: accept an immediate quote from a funded lending pool, or list the payout right on the marketplace when the borrowing amount does not suit them. The user chose the funded-pool model and the black, evergreen, black-forest, sea-green, and malachite palette on 13 November 2026.

Both paths need enforceable control of the payout right. A non-transferable DEX position cannot become collateral or a sellable claim just by displaying it in Lockpad. The local reference source supports payout NFTs. Other sources need an adapter, approved beneficiary assignment, or an escrow/wrapper that controls redemption. Until a source provides that control and passes validation, borrowing and listing remain unavailable for it.

## Local implementation

The existing source vault, marketplace, and TUSD contracts are retained. A separate lending pool accepts the eligible payout NFT as collateral, reserves existing pool liquidity, and pays the borrower. The source retains the original principal and maturity. A position cannot be in the market and the lending pool simultaneously.

The prototype starts with illustrative maximum borrowing of 65% of the fixed source principal and a one-time 2% fee on the borrowed amount. A 1,000 TUSD position can receive 650 TUSD and repay 663 TUSD by its original maturity. These are labelled prototype terms; there is no price oracle, production rate model, or claim that arbitrary DeFi positions have this value. The offer is bounded by the pool's actual available liquidity.

Repayment returns the original payout NFT to the borrower. If the loan remains unpaid at maturity, the pool claims the original source payout, retains only the amount due, and credits the remainder to the borrower for withdrawal. Failed or uncertain operations retain a pending state and cannot be replayed blindly. NFT returns use the source's expiring transfer receipts for reconciliation.

The local demo shows the borrowing quote, a completed borrow and repayment, the sale alternative, receipt history, and the distinction between supported payout rights and non-transferable positions that need an adapter. It is proposed work to refine before mainnet. No mainnet, universal DEX support, independent adoption, or audit is claimed.

## Interface

Black `#020202` is the canvas, evergreen `#0d2818` is the main surface, black forest `#04471c` provides depth and borders, sea green `#058c42` marks secondary state, and malachite `#16db65` marks primary actions. Readable neutral text complements the supplied palette. The main journey is position → borrowing quote → accept or list; repayment and sale receipts remain accessible from My positions and Activity.

The two-minute narrated walkthrough records the verified borrowing, repayment, sale and original-maturity payout journey with the supplied green palette and existing ElevenLabs Jack John voice. Its capture assertions, word alignment, editable source and export verification are in `demo-video/`. The earlier 90-second resale video and its real footage remain archived as a separate draft.

## DEX research

The [NEAR DEX research](research/near-dex-position-transferability-2026-11-13.md) recommends Rhea DCL NFTs for the first real adapter, followed by Rhea classic and Jumbo classic MFT shares. Read-only mainnet queries confirmed their transfer interfaces. Spin option-vault shares are a conditional lead for native weekly withdrawal delays; its deployed vault exposes MFT transfers, but current operations and recipient withdrawal remain unverified. Rhea's existing LP locker has account-bound timed claims, so its locks cannot be imported simply by wrapping a displayed receipt. Ordinary LP and vault-share values change with underlying assets, fees, and strategy exposure. The current demo therefore retains its fixed-payout reference source; third-party adapters, timed LP wrappers, and production loan valuation remain proposed work before mainnet.
