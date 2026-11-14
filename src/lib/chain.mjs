const build = import.meta.env || {};
export const localDemo = build.VITE_DEMO === "1";
export const ONE = "1";
let connectorPromise;
let environmentPromise;

async function jsonFetch(url, body) {
  const response = await fetch(url, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.cause?.info?.error_message || payload.error?.message || `Request failed (${response.status}).`);
  return payload;
}

export async function getEnvironment() {
  environmentPromise ||= localDemo ? jsonFetch("/api/demo/config") : Promise.resolve({
    mode: "testnet", runId: "testnet", network: "testnet",
    market: build.VITE_MARKET_ACCOUNT || "", token: build.VITE_TOKEN_ACCOUNT || "", vault: build.VITE_VAULT_ACCOUNT || "", pool: build.VITE_POOL_ACCOUNT || "",
    rpc: build.VITE_NEAR_RPC || "https://test.rpc.fastnear.com", accounts: [],
  });
  return environmentPromise;
}

export async function view(contractId, methodName, args = {}) {
  const environment = await getEnvironment();
  if (localDemo) return (await jsonFetch("/api/demo/view", { contractId, methodName, args })).result;
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  const payload = await jsonFetch(environment.rpc, {
    jsonrpc: "2.0", id: "lockpad-view", method: "query", params: {
      request_type: "call_function", finality: "final", account_id: contractId, method_name: methodName,
      args_base64: btoa(String.fromCharCode(...bytes)),
    },
  });
  if (!payload.result?.result) throw new Error("The NEAR node returned an incomplete response.");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(payload.result.result)));
}

export function connector() {
  connectorPromise ||= import("@hot-labs/near-connect").then(({ NearConnector }) => new NearConnector({ network: "testnet" }));
  return connectorPromise;
}

export async function restoreAccount() {
  const environment = await getEnvironment();
  if (localDemo) {
    const saved = localStorage.getItem(`lockpad-account:${environment.runId}`);
    return environment.accounts.some(account => account.accountId === saved) ? saved : "";
  }
  const wallet = await (await connector()).wallet();
  return (await wallet?.getAccounts({ network: "testnet" }))?.[0]?.accountId || "";
}

export async function connectAccount(accountId) {
  const environment = await getEnvironment();
  if (localDemo) {
    if (!environment.accounts.some(account => account.accountId === accountId)) throw new Error("Choose a local test wallet.");
    localStorage.setItem(`lockpad-account:${environment.runId}`, accountId);
    return accountId;
  }
  const current = await connector();
  await current.connect();
  return (await (await current.wallet()).getAccounts({ network: "testnet" }))?.[0]?.accountId || "";
}

export async function disconnectAccount() {
  const environment = await getEnvironment();
  if (localDemo) localStorage.removeItem(`lockpad-account:${environment.runId}`);
  else await (await connector()).disconnect();
}

export function action(receiverId, methodName, args = {}, deposit = ONE) {
  return { receiverId, methodName, args, deposit, gas: "180000000000000" };
}

export async function sendAction(accountId, action) {
  if (localDemo) return (await jsonFetch("/api/demo/transaction", { signerId: accountId, ...action })).result;
  const wallet = await (await connector()).wallet();
  const accounts = await wallet?.getAccounts({ network: "testnet" });
  if (!accounts?.some(account => account.accountId === accountId)) throw new Error("The connected wallet changed. Reconnect before continuing.");
  const result = await wallet.signAndSendTransaction({
    signerId: accountId, receiverId: action.receiverId,
    actions: [{ type: "FunctionCall", params: { methodName: action.methodName, args: action.args, gas: action.gas, deposit: action.deposit } }],
  });
  if (!result) throw new Error("The wallet returned without a receipt. Check wallet activity before trying again.");
  const hash = result.transaction?.hash || result.transaction_outcome?.id;
  if (!hash) throw new Error("The wallet did not return a transaction hash. Check wallet activity before retrying.");
  try { return await getOutcome(hash, accountId); }
  catch (cause) {
    const error = new Error("Your transaction was sent, but confirmation is unavailable. Check its receipt in Activity before retrying.", { cause });
    error.hash = hash;
    throw error;
  }
}

export async function getOutcome(hash, accountId) {
  if (localDemo) return jsonFetch(`/api/demo/receipt/${encodeURIComponent(hash)}`);
  const environment = await getEnvironment();
  const confirmed = await jsonFetch(environment.rpc, { jsonrpc: "2.0", id: "lockpad-receipt", method: "tx", params: { tx_hash: hash, sender_account_id: accountId, wait_until: "FINAL" } });
  return confirmed.result;
}

export function assertOutcome(result, action) {
  if (!result?.status || typeof result.status !== "object") throw new Error("Execution is not confirmed yet. Check the receipt before retrying.");
  if (result.status.Failure) throw new Error("The transaction failed. Your receipt has the details.");
  if (!("SuccessValue" in result.status)) throw new Error("Settlement is still pending. Check the receipt before retrying.");
  let raw;
  try { raw = atob(result.status.SuccessValue); }
  catch { throw new Error("The receipt is incomplete. Check Activity before retrying."); }
  if (raw === "false" && !action.allowFalse) throw new Error(action.methodName === "buy" ? "Delivery could not be confirmed. Check the position's settlement status before withdrawing or retrying." : "The action did not complete. Refresh the position and check the receipt before retrying.");
  if (action.methodName === "ft_transfer_call" && raw !== JSON.stringify(action.args.amount)) throw new Error("The token deposit was returned. Your tokens remain in your wallet.");
}

export function receiptUrl(hash) { return localDemo ? `/api/demo/receipt/${encodeURIComponent(hash)}` : `https://testnet.nearblocks.io/txns/${encodeURIComponent(hash)}`; }
