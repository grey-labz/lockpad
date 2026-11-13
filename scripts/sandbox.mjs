import { Worker } from "near-workspaces";
import { access, chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createServer as createSocketServer } from "node:net";

export const project = resolve(import.meta.dirname, "..");
export const GAS = "180000000000000";
export const ONE = "1";
export const STORAGE = "30000000000000000000000";
export const OPERATION_STORAGE = "10000000000000000000000";
const exec = promisify(execFile);

async function checkLocalSockets() {
  await new Promise((resolve, reject) => {
    const probe = createSocketServer();
    probe.once("error", cause => reject(new Error("NEAR Sandbox needs permission to open local sockets. Run this command in a terminal with local network access.", { cause })));
    probe.listen({ host: "0.0.0.0", port: 0 }, () => probe.close(error => error ? reject(error) : resolve()));
  });
}

export async function ensureSandboxBinary() {
  if (process.env.LOCKPAD_SANDBOX_BINARY) {
    await access(process.env.LOCKPAD_SANDBOX_BINARY, constants.X_OK);
    process.env.NEAR_SANDBOX_BIN_PATH = "1";
    process.env.NEAR_SANDBOX_BINARY_PATH = resolve(process.env.LOCKPAD_SANDBOX_BINARY, "..");
    return;
  }
  const directory = join(project, ".demo/bin");
  const binary = join(directory, "near-sandbox");
  await mkdir(directory, { recursive: true });
  try { await access(binary, constants.X_OK); }
  catch {
    const imported = join(project, "work/sandbox/Linux-x86_64/near-sandbox");
    try { await copyFile(imported, binary); }
    catch {
      if (process.platform !== "linux" || process.arch !== "x64") {
        throw new Error("Set LOCKPAD_SANDBOX_BINARY to a NEAR Sandbox 2.14.1 executable for your platform. See docs/SETUP.md.");
      }
      console.log("Downloading NEAR Sandbox 2.14.1 (Linux x86-64)…");
      const response = await fetch("https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.1/near-sandbox.tar.gz", { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`Sandbox download failed: HTTP ${response.status}`);
      const archive = join(directory, "near-sandbox.tar.gz");
      await writeFile(archive, new Uint8Array(await response.arrayBuffer()));
      await exec("tar", ["-xzf", archive, "-C", directory]);
      await copyFile(join(directory, "Linux-x86_64/near-sandbox"), binary);
    }
    await chmod(binary, 0o755);
  }
  process.env.NEAR_SANDBOX_BIN_PATH = "1";
  process.env.NEAR_SANDBOX_BINARY_PATH = directory;
}

export async function ensureContracts() {
  const manifestPath = join(project, "docs/evidence/contract-build.json");
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch { throw new Error("Build contracts first: npm run contracts:build"); }
  for (const [file, expected] of Object.entries(manifest.sources || {})) {
    const actual = createHash("sha256").update(await readFile(join(project, file))).digest("hex");
    if (actual !== expected) throw new Error(`Contract source changed: ${file}. Run npm run contracts:build.`);
  }
  for (const [file, expected] of Object.entries(manifest.contracts)) {
    const binary = await readFile(join(project, "res", file));
    if (createHash("sha256").update(binary).digest("hex") !== expected.sha256) throw new Error(`Contract artifact mismatch: ${file}`);
  }
}

export async function createSandbox({ seed = false, onReceipt = () => {} } = {}) {
  await checkLocalSockets();
  console.log("Checking contract artifacts and Sandbox executable…");
  await ensureContracts();
  await ensureSandboxBinary();
  console.log("Launching NEAR Sandbox…");
  const worker = await Worker.init({ network: "sandbox" });
  console.log("NEAR Sandbox running. Creating temporary accounts…");
  try {
    const root = worker.rootAccount;
    const accounts = {};
    for (const name of ["token", "vault", "market", "alice", "bob", "nora", "stranger"]) {
      accounts[name] = await root.createSubAccount(name);
    }
    const { token, vault, market } = accounts;
    console.log("Deploying the reference vault, marketplace and test token…");
    const deployments = await Promise.allSettled([
      token.deploy(join(project, "res/lockpad_test_token.wasm")),
      vault.deploy(join(project, "res/lockpad_reference_vault.wasm")),
      market.deploy(join(project, "res/lockpad_marketplace.wasm")),
    ]);
    for (const outcome of deployments) { if (outcome.status === "rejected") throw outcome.reason; }
    await token.call(token, "new", {});
    await vault.call(vault, "new", { asset_id: token.accountId });
    await market.call(market, "new", { asset_id: token.accountId, source_ids: [vault.accountId] });
    const send = async (signer, receiver, methodName, args = {}, deposit = ONE, gas = GAS) => {
      const result = await signer.callRaw(receiver, methodName, args, { attachedDeposit: deposit, gas });
      onReceipt(result.result);
      return result;
    };
    const bounds = await token.view("storage_balance_bounds", {});
    for (const account of [vault, market, accounts.alice, accounts.bob, accounts.nora]) {
      await send(account, token, "storage_deposit", { account_id: account.accountId, registration_only: true }, bounds.min);
      if (![vault, market].includes(account)) {
        await send(account, market, "register_account", {}, STORAGE);
        await send(account, token, "faucet", {}, "0");
      }
    }
    const lock = async (signer, amount, duration) => {
      await send(signer, vault, "prepay_lock", {}, STORAGE);
      const result = await send(signer, token, "ft_transfer_call", {
        receiver_id: vault.accountId, amount, msg: JSON.stringify({ action: "lock", duration }),
      });
      if (result.parseResult() !== amount) throw new Error("Reference vault rejected seed funding");
      const positions = await vault.view("get_positions_by_owner", { owner_id: signer.accountId, from_index: "0", limit: 100 });
      return positions.sort((a, b) => Number(BigInt(b.token_id) - BigInt(a.token_id)))[0];
    };
    const list = async (signer, tokenId, price) => {
      await send(signer, market, "prepay_listing", {}, STORAGE);
      const result = await send(signer, vault, "nft_transfer_call", {
        receiver_id: market.accountId, token_id: tokenId, msg: JSON.stringify({ price }),
      });
      if (result.parseResult() !== true) throw new Error("Marketplace rejected seed position");
      return (await market.view("get_listings_by_seller", { seller_id: signer.accountId, from_index: 0, limit: 100 })).at(-1);
    };
    if (seed) {
      console.log("Creating real local test positions…");
      await lock(accounts.alice, "1000000000", 300);
      for (let i = 0; i < 2; i++) await send(accounts.nora, token, "faucet", {}, "0");
      for (const [amount, price, duration] of [["1000000000", "920000000", 2592000], ["500000000", "480000000", 604800], ["1000000000", "900000000", 7776000]]) {
        const position = await lock(accounts.nora, amount, duration);
        await list(accounts.nora, position.token_id, price);
      }
    }
    return { worker, accounts, token, vault, market, send, lock, list, close: () => worker.tearDown() };
  } catch (error) {
    await worker.tearDown();
    throw error;
  }
}
