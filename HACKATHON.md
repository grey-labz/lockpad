# Lockpad hackathon work

Primary track: Unstoppable DeFi (`defi`). The submission describes transferable fixed-maturity payout rights; it claims neither AI nor NEAR Intents integration.

The saved [implementation plan](docs/implementation-plan.md) records the approved centered teal design and three-contract reference-source scope. The [live organizer instructions](https://nearhackathon.com/HACKATHON.md) were rechecked on 13 November 2026 and are saved in [the rules snapshot](docs/evidence/hackathon-rules-2026-11-13.md). Development and submission end 14 November 2026 at 23:59 UTC (15 November at 00:59 in Lagos).

The development baseline is `cb4097c` on `hackathon/lockpad-resale`. The imported repository is retained under ignored `outputs/timeshift`; the active root is `/home/greyw0rks/Lockpad`. The local work changes the eligibility-only interface and self-issued vault into a working, separate-source settlement demo. Review the working tree and untracked source/evidence files together; the new implementation is not yet a published commit.

The implementation plan reserves a separate confirmation for publication, public-network transactions and submission. The organizer instructions also explicitly require human confirmation before pushing or signing transactions. The [reviewed release guide](docs/RELEASE.md) makes those actions concrete: three fresh testnet accounts, three exact deployments, two token registrations, and the source/Pages publication. Those external release actions have not been performed.

Current reviewer materials: [setup and judge guide](docs/SETUP.md), [architecture and limits](docs/ARCHITECTURE.md), [submission draft](SUBMISSION.md), [release guide](docs/RELEASE.md), [handoff](docs/HANDOFF.md), and saved contract/browser/release evidence. One person may submit at most two independent projects; confirm existing entries before submitting Lockpad.
