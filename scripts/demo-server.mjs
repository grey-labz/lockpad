import { createServer } from "vite";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createSandbox, project, OPERATION_STORAGE, STORAGE, ONE } from "./sandbox.mjs";

const viewMethods = {
  market: new Set(["get_config", "get_account", "get_accounting", "get_listing", "get_listings", "get_listings_by_seller", "get_activity"]),
  vault: new Set(["get_config", "get_position", "get_positions_by_owner", "lock_credits", "get_transfer_result", "nft_token", "nft_tokens_for_owner"]),
  token: new Set(["ft_metadata", "ft_balance_of", "storage_balance_of", "storage_balance_bounds"]),
  pool: new Set(["get_config", "get_accounting", "get_account", "get_quote", "get_loan", "get_loans_by_borrower"]),
};
const writeMethods = {
  market: new Set(["register_account", "prepay_listing", "buy", "cancel_listing", "reconcile", "withdraw_balance", "withdraw_proceeds"]),
  vault: new Set(["prepay_lock", "nft_transfer_call", "redeem"]),
  token: new Set(["storage_deposit", "ft_transfer_call", "faucet"]),
  pool: new Set(["register_account", "prepay_loan", "draw_loan", "reset_expired_check", "cancel_collateral", "release_collateral", "reconcile_return", "settle_maturity", "reconcile_maturity", "withdraw_surplus"]),
};

export async function startDemoServer({ port = Number(process.env.LOCKPAD_DEMO_PORT || 5273), seed = true } = {}) {
  const receipts = new Map();
  console.log("Starting an isolated local NEAR Sandbox. No public-network transactions are sent.");
  const sandbox = await createSandbox({ seed, onReceipt: result => receipts.set(result.transaction.hash, result) });
  const { accounts, token, vault, market, pool, worker } = sandbox;
  const contractById = new Map([[token.accountId, ["token", token]], [vault.accountId, ["vault", vault]], [market.accountId, ["market", market]], [pool.accountId, ["pool", pool]]]);
  const signers = new Map([accounts.alice, accounts.bob, accounts.nora].map(account => [account.accountId, account]));
  const config = {
    mode: "sandbox", network: "local NEAR Sandbox", runId: randomUUID(),
    market: market.accountId, vault: vault.accountId, token: token.accountId, pool: pool.accountId,
    accounts: [
      { accountId: accounts.alice.accountId, name: "Alice", role: "Position owner · can borrow or sell" },
      { accountId: accounts.bob.accountId, name: "Bob", role: "Buyer · holds test tokens" },
      { accountId: accounts.nora.accountId, name: "Nora", role: "Fixture lender · listed reference positions" },
    ],
  };
  let queue = Promise.resolve();
  const serialized = operation => { const next = queue.then(operation, operation); queue = next.catch(() => {}); return next; };
  const respond = (response, status, data) => {
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(JSON.stringify(data));
  };
  const plugin = {
    name: "lockpad-local-sandbox",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/api/demo/")) return next();
        try {
          const host = request.headers.host;
          if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) return respond(response, 403, { error: "The demo is available only on its local address." });
          if (request.method === "GET" && request.url === "/api/demo/config") return respond(response, 200, config);
          if (request.method === "GET" && request.url.startsWith("/api/demo/receipt/")) {
            const receipt = receipts.get(decodeURIComponent(request.url.slice("/api/demo/receipt/".length)));
            return respond(response, receipt ? 200 : 404, receipt || { error: "Receipt not found in this local run." });
          }
          if (request.method === "GET" && request.url === "/api/demo/evidence") {
            return respond(response, 200, { ...config, recordedAt: new Date().toISOString(), accounting: await market.view("get_accounting", {}), lending: await pool.view("get_accounting", {}), receipts: [...receipts.values()] });
          }
          if (request.method !== "POST" || request.headers.origin !== `http://${host}` || !request.headers["content-type"]?.startsWith("application/json")) {
            return respond(response, 403, { error: "Use the local demo application for this action." });
          }
          let body = "";
          for await (const chunk of request) { body += chunk; if (body.length > 16384) return respond(response, 413, { error: "Request is too large." }); }
          const payload = JSON.parse(body);
          if (request.url === "/api/demo/view") {
            const contract = contractById.get(payload.contractId);
            if (!contract || !viewMethods[contract[0]].has(payload.methodName)) return respond(response, 400, { error: "Unsupported local view." });
            return respond(response, 200, { result: await contract[1].view(payload.methodName, payload.args || {}) });
          }
          if (request.url === "/api/demo/transaction") {
            const signer = signers.get(payload.signerId);
            const contract = contractById.get(payload.receiverId);
            if (!signer || !contract || !writeMethods[contract[0]].has(payload.methodName)) return respond(response, 400, { error: "Unsupported local wallet action." });
            validateAction(payload, contract[0], signer.accountId, config);
            const result = await serialized(() => sandbox.send(signer, contract[1], payload.methodName, payload.args || {}, payload.deposit, payload.gas));
            return respond(response, 200, { result: result.result });
          }
          return respond(response, 404, { error: "Unknown demo endpoint." });
        } catch (error) { return respond(response, 400, { error: error.message }); }
      });
    },
  };
  let vite;
  try {
    vite = await createServer({
      root: project, configFile: resolve(project, "vite.config.js"),
      define: { "import.meta.env.VITE_DEMO": JSON.stringify("1") },
      server: { host: "127.0.0.1", port, strictPort: true }, plugins: [plugin],
    });
    await vite.listen();
  } catch (error) { await sandbox.close(); throw error; }
  const url = `http://127.0.0.1:${vite.httpServer.address().port}/`;
  console.log(`Lockpad demo ready: ${url}`);
  const close = async () => { await vite.close(); await sandbox.close(); };
  return { ...sandbox, vite, url, config, receipts, close };
}

function validateAction(action, contract, signerId, config) {
  if (!/^\d+$/.test(String(action.gas)) || BigInt(action.gas) > 200_000_000_000_000n || BigInt(action.gas) < 50_000_000_000_000n) throw new Error("Unsupported gas amount.");
  const args = action.args || {};
  const expected = ["register_account", "prepay_listing", "prepay_lock", "prepay_loan"].includes(action.methodName) ? STORAGE
    : ["buy", "cancel_listing", "cancel_collateral", "release_collateral"].includes(action.methodName) ? OPERATION_STORAGE
    : ["faucet", "reconcile", "reset_expired_check", "reconcile_return", "reconcile_maturity"].includes(action.methodName) ? "0" : ONE;
  if (action.methodName !== "storage_deposit" && action.deposit !== expected) throw new Error("The local action has an unexpected storage deposit.");
  if (action.methodName === "storage_deposit" && (args.account_id !== signerId || args.registration_only !== true || !/^\d+$/.test(action.deposit) || BigInt(action.deposit) > BigInt(STORAGE))) throw new Error("Only the selected test wallet can be registered.");
  if (contract === "vault" && action.methodName === "nft_transfer_call" && ![config.market, config.pool].includes(args.receiver_id)) throw new Error("Use the local marketplace or lending pool for this payout right.");
  if (action.methodName === "ft_transfer_call") {
    if (![config.market, config.vault, config.pool].includes(args.receiver_id) || !/^\d+$/.test(args.amount) || BigInt(args.amount) <= 0n || BigInt(args.amount) >= (1n << 128n)) throw new Error("Unsupported test token transfer.");
    const message = JSON.parse(args.msg);
    if (message.action !== (args.receiver_id === config.market ? "deposit" : args.receiver_id === config.pool ? "repay" : "lock")) throw new Error("Unsupported token transfer action.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startDemoServer();
  let closing = false;
  const stop = async () => { if (closing) return; closing = true; await server.close(); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
