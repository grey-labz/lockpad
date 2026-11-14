import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cache = resolve(root, "docs/research/near-dex-sources");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const read = async name => JSON.parse(await readFile(resolve(cache, name), "utf8"));
const report = {
  checkedAt: new Date().toISOString(),
  scope: "Read-only public documentation, source code, and NEAR RPC research",
  networkTransactions: 0,
  transferExecutionVerified: false,
  recommendation: "Prototype Rhea DCL NFTs first; add Rhea classic and Jumbo classic through an MFT adapter.",
  limitation: "Transferable LP rights do not prove a transferable existing timed lock. No production adapter was implemented or tested.",
  mainnet: (await read("near-mainnet-status.json")).result.sync_info,
  contracts: [],
  views: [],
  sourceSnapshots: [],
};

const contracts = [
  ["dcl-official-code.json", "dclv2.ref-labs.near", "mainnet"],
  ["v2.ref-finance.near-code.json", "v2.ref-finance.near", "mainnet"],
  ["token-locker.ref-labs.near-code.json", "token-locker.ref-labs.near", "mainnet"],
  ["v1.jumbo_exchange.near-code.json", "v1.jumbo_exchange.near", "mainnet"],
  ["farming-v1.jumbo_exchange.near-code.json", "farming-v1.jumbo_exchange.near", "mainnet"],
  ["rhea-dcl-testnet-code.json", "dclv2.ref-dev.testnet", "testnet"],
];
for (const [file, accountId, network] of contracts) {
  const response = await read(file);
  if (response.error) {
    report.contracts.push({ accountId, network, error: response.error });
    continue;
  }
  const result = response.result;
  const bytes = Buffer.from(result.code_base64, "base64");
  report.contracts.push({
    accountId, network, blockHeight: result.block_height, blockHash: result.block_hash,
    codeHash: result.hash, wasmSha256: sha(bytes), wasmBytes: bytes.length,
    exportedMethods: WebAssembly.Module.exports(new WebAssembly.Module(bytes)).filter(item => item.kind === "function").map(item => item.name),
  });
}
const views = [
  ["rhea-dcl-metadata.json", "dclv2.ref-labs.near", "get_metadata"],
  ["rhea-dcl-nft-sample.json", "dclv2.ref-labs.near", "nft_tokens"],
  ["rhea-locker-metadata.json", "token-locker.ref-labs.near", "get_metadata"],
  ["jumbo-metadata.json", "v1.jumbo_exchange.near", "metadata"],
  ["jumbo-pool-sample.json", "v1.jumbo_exchange.near", "get_pool"],
];
for (const [file, accountId, method] of views) {
  const response = await read(file);
  if (response.error) report.views.push({ accountId, method, error: response.error });
  else {
    const result = response.result;
    report.views.push({ accountId, method, blockHeight: result.block_height, blockHash: result.block_hash, value: JSON.parse(Buffer.from(result.result).toString("utf8")) });
  }
}
const sources = [
  ["rhea-guide-head.json", "ref-finance/guide", ["rhea-clmm.md", "rhea-classic.md", "rhea-lp-collateral.md", "rhea-contracts.md"]],
  ["ref-ui-head.json", "ref-finance/ref-ui", ["ref-farm.ts", "ref-lp-locker.ts"]],
  ["rhea-locker-head.json", "ref-finance/token_locker", ["rhea-locker-account.rs", "rhea-locker-lib.rs", "rhea-locker-view.rs"]],
  ["jumbo-head.json", "jumbo-exchange/contracts", ["jumbo-mft.rs", "jumbo-seed.rs"]],
  ["veax-head.json", "tacanslabs/veax", ["veax-wasm.rs", "veax-impl.rs"]],
];
for (const [headFile, repository, files] of sources) {
  const head = await read(headFile);
  const hashes = [];
  for (const file of files) hashes.push({ cachedFile: file, sha256: sha(await readFile(resolve(cache, file))) });
  report.sourceSnapshots.push({ repository, commit: head.object.sha, files: hashes });
}
const destination = resolve(root, "docs/evidence/near-dex-research-2026-11-13.json");
await writeFile(destination, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ destination, contracts: report.contracts.map(({ accountId, codeHash, exportedMethods, error }) => ({ accountId, codeHash, transferMethods: exportedMethods?.filter(name => /^(nft|mft)_transfer/.test(name)), error: error?.cause?.name })), viewQueries: report.views.map(({ accountId, method, error }) => ({ accountId, method, error: error?.cause?.name })) }, null, 2));
