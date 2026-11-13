import { useCallback, useEffect, useRef, useState } from "react";
import { action, assertOutcome, connectAccount, connector, disconnectAccount, getEnvironment, getOutcome, localDemo, receiptUrl, restoreAccount, sendAction, view } from "../lib/chain.mjs";
import { timestampMs, toUnits } from "../lib/amounts.mjs";
import { assertEligible } from "../lib/market.mjs";

const emptyAccount = { available: "0", proceeds: "0", listing_credits: 0, withdrawal: null };
const initial = { listings: [], activity: [], holdings: [], sellerListings: [], ledger: emptyAccount, tokenBalance: "0", sources: [], ready: false, portfolioOwner: "" };

function savedJournal(runId) {
  try { return JSON.parse(localStorage.getItem(`lockpad-journal:${runId}`) || "[]"); }
  catch { return []; }
}

export function useLockpad() {
  const [environment, setEnvironment] = useState(null);
  const [account, setAccount] = useState("");
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [journal, setJournal] = useState([]);
  const generation = useRef(0);
  const running = useRef(false);
  const currentAccount = useRef(account);
  currentAccount.current = account;
  const latestRefresh = useRef(null);

  useEffect(() => {
    let closed = false;
    getEnvironment().then(async env => {
      if (closed) return;
      setEnvironment(env);
      setJournal(savedJournal(env.runId));
      if (env.market) try { const restored = await restoreAccount(); if (!closed) setAccount(restored); } catch { /* Disconnected browsing remains available. */ }
    }).catch(error => { if (!closed) { setError(error.message); setLoading(false); } });
    return () => { closed = true; };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + clockOffset), 1000);
    return () => clearInterval(timer);
  }, [clockOffset]);

  useEffect(() => {
    if (localDemo || !environment?.market) return;
    let instance;
    const signedIn = ({ accounts }) => setAccount(accounts?.[0]?.accountId || "");
    const signedOut = () => setAccount("");
    connector().then(current => { instance = current; current.on("wallet:signIn", signedIn); current.on("wallet:signOut", signedOut); }).catch(() => {});
    return () => { instance?.off?.("wallet:signIn", signedIn); instance?.off?.("wallet:signOut", signedOut); };
  }, [environment]);

  const refresh = useCallback(async () => {
    if (!environment) return;
    const ticket = ++generation.current;
    if (!environment.market || !environment.token || !environment.vault) {
      setError("This marketplace is awaiting its public testnet deployment. You can still explore how payout resale works.");
      setLoading(false);
      return;
    }
    try {
      const [config, metadata] = await Promise.all([
        view(environment.market, "get_config"), view(environment.token, "ft_metadata"),
      ]);
      if (config.version !== "lockpad-market-v1" || config.asset_id !== environment.token || metadata.decimals !== 6 || !config.source_ids.includes(environment.vault)) {
        throw new Error("Contract configuration does not match this application. Transactions are disabled.");
      }
      const sources = await Promise.all(config.source_ids.map(async sourceId => {
        const source = await view(sourceId, "get_config");
        if (source.version !== "lockpad-reference-v1" || source.asset_id !== config.asset_id) throw new Error("The source adapter is incompatible with this market.");
        return { ...source, id: sourceId, name: "Reference vault" };
      }));
      const [listings, activity, ledger, tokenBalance, holdings, sellerListings] = await Promise.all([
        view(environment.market, "get_listings", { from_index: 0, limit: 100 }),
        view(environment.market, "get_activity", { from_index: 0, limit: 100 }),
        account ? view(environment.market, "get_account", { account_id: account }) : null,
        account ? view(environment.token, "ft_balance_of", { account_id: account }) : "0",
        account ? Promise.all(sources.map(async source => (await view(source.id, "get_positions_by_owner", { owner_id: account, from_index: "0", limit: 100 })).map(position => ({ ...position, source_id: source.id })))) : [],
        account ? view(environment.market, "get_listings_by_seller", { seller_id: account, from_index: 0, limit: 100 }) : [],
      ]);
      if (ticket !== generation.current) return;
      const offset = timestampMs(config.timestamp) - Date.now();
      setClockOffset(offset); setNow(Date.now() + offset);
      setData({ listings, activity, ledger: ledger || emptyAccount, registered: Boolean(ledger), tokenBalance, holdings: holdings.flat(), sellerListings, config, metadata, sources, ready: true, portfolioOwner: account });
      setError("");
    } catch (error) {
      if (ticket === generation.current) { setError(error.message); setData(current => ({ ...current, ready: false })); }
    } finally { if (ticket === generation.current) setLoading(false); }
  }, [environment, account]);
  latestRefresh.current = refresh;

  useEffect(() => { refresh(); const timer = setInterval(refresh, 20000); return () => { clearInterval(timer); generation.current++; }; }, [refresh]);

  useEffect(() => {
    if (environment) try { localStorage.setItem(`lockpad-journal:${environment.runId}`, JSON.stringify(journal.slice(0, 100))); } catch { /* Receipts remain visible when browser storage is unavailable. */ }
  }, [journal, environment]);

  async function connect(accountId) {
    try { const connected = await connectAccount(accountId); setAccount(connected); return true; }
    catch (error) { setNotice({ type: "error", message: error.message }); return false; }
  }

  async function disconnect() {
    try { await disconnectAccount(); setAccount(""); }
    catch (error) { setNotice({ type: "error", message: error.message }); }
  }

  async function run(label, execute) {
    if (running.current || !account || !data.ready || data.portfolioOwner !== account) return false;
    running.current = true;
    setBusy(true); setNotice(null);
    const signer = account;
    let receipt;
    try {
      await execute(async (request, step = label, options = {}) => {
        if (currentAccount.current !== signer) throw new Error("The connected wallet changed. Review the confirmed steps in Activity before continuing.");
        setProgress(step);
        const id = crypto.randomUUID();
        setJournal(current => [{ id, label: step, state: "Awaiting approval", signer, request, createdAt: new Date().toISOString() }, ...current]);
        let hash, stepReceipt;
        try {
          const result = await sendAction(signer, request);
          hash = result?.transaction?.hash || result?.transaction_outcome?.id;
          stepReceipt = hash ? receiptUrl(hash) : undefined;
          if (stepReceipt) receipt = stepReceipt;
          assertOutcome(result, { ...request, ...options });
          setJournal(current => current.map(item => item.id === id ? { ...item, state: "Confirmed", hash, receipt: stepReceipt } : item));
          return result;
        } catch (error) {
          hash ||= error.hash;
          stepReceipt ||= hash ? receiptUrl(hash) : undefined;
          if (stepReceipt) receipt = stepReceipt;
          setJournal(current => current.map(item => item.id === id ? { ...item, state: "Review receipt", hash, receipt: stepReceipt, error: error.message } : item));
          throw error;
        }
      });
      if (currentAccount.current !== signer) throw new Error("The connected wallet changed. Your confirmed steps are saved in Activity.");
      setNotice({ type: "success", message: label, receipt });
      return true;
    } catch (error) {
      setNotice({ type: "error", message: error.message, receipt });
      return false;
    } finally {
      setProgress("");
      await latestRefresh.current?.();
      setBusy(false); running.current = false;
    }
  }

  const ensureTokenAccount = async send => {
    const registered = await view(environment.token, "storage_balance_of", { account_id: account });
    if (!registered) {
      const bounds = await view(environment.token, "storage_balance_bounds");
      await send(action(environment.token, "storage_deposit", { account_id: account, registration_only: true }, bounds.min), "Preparing your token account");
    }
  };
  const ensureMarketAccount = async send => {
    if (!await view(environment.market, "get_account", { account_id: account })) {
      await send(action(environment.market, "register_account", {}, data.config.account_storage), "Preparing your marketplace account");
    }
  };

  const faucet = () => run("Test tokens added to your wallet.", async send => { await ensureTokenAccount(send); await send(action(environment.token, "faucet", {}, "0"), "Getting test tokens"); });
  const withdraw = kind => run(kind === "proceeds" ? "Sale proceeds arrived in your wallet." : "Unused market funds returned to your wallet.", async send => {
    await ensureTokenAccount(send);
    await send(action(environment.market, kind === "proceeds" ? "withdraw_proceeds" : "withdraw_balance"), "Withdrawing your funds");
  });

  const buy = listing => run("Position purchased. The payout right is now yours.", async send => {
    const latest = await view(environment.market, "get_listing", { listing_id: listing.id });
    if (latest?.status !== "Open" || latest.quote_nonce !== listing.quote_nonce || latest.price !== listing.price) throw new Error("This listing changed. Refresh it before buying.");
    if (latest.seller_id === account) throw new Error("You cannot buy your own position.");
    if (timestampMs(latest.unlock_at) <= now) throw new Error("This position has matured and is no longer for sale.");
    await ensureMarketAccount(send);
    const ledger = await view(environment.market, "get_account", { account_id: account });
    const needed = BigInt(listing.price) > BigInt(ledger.available) ? BigInt(listing.price) - BigInt(ledger.available) : 0n;
    const walletBalance = await view(environment.token, "ft_balance_of", { account_id: account });
    if (needed > BigInt(walletBalance)) throw new Error("Your test token balance is too low. Get test tokens in My positions.");
    if (needed) await send(action(environment.token, "ft_transfer_call", { receiver_id: environment.market, amount: needed.toString(), msg: JSON.stringify({ action: "deposit" }) }), "Funding your purchase");
    await send(action(environment.market, "buy", { listing_id: listing.id, quote_nonce: listing.quote_nonce }, data.config.operation_storage), "Transferring the payout right");
    const position = await view(listing.source_id, "get_position", { token_id: listing.token_id });
    if (position?.owner_id !== account) throw new Error("Ownership is not confirmed yet. Keep the receipt and refresh before another action.");
  });

  const list = (position, price) => run("Your position is listed on the marketplace.", async send => {
    const latest = await view(position.source_id, "get_position", { token_id: position.token_id });
    assertEligible(latest, position.source_id, account, environment, now);
    if (BigInt(price) <= 0n || BigInt(price) >= BigInt(latest.principal)) throw new Error("Set a positive price below the locked payout.");
    await ensureMarketAccount(send);
    const ledger = await view(environment.market, "get_account", { account_id: account });
    if (!ledger.listing_credits) await send(action(environment.market, "prepay_listing", {}, data.config.listing_storage), "Preparing your listing");
    await send(action(position.source_id, "nft_transfer_call", { receiver_id: environment.market, token_id: position.token_id, msg: JSON.stringify({ price }) }), "Listing your payout right");
    if ((await view(position.source_id, "get_position", { token_id: position.token_id }))?.owner_id !== environment.market) throw new Error("Listing ownership is not confirmed yet. Check Activity before retrying.");
  });

  const cancel = listing => run("Listing removed. The payout right is back in your wallet.", send => send(action(environment.market, "cancel_listing", { listing_id: listing.id }, data.config.operation_storage), "Returning your payout right"));
  const redeem = position => run("The full maturity payout arrived in your wallet.", async send => {
    await ensureTokenAccount(send);
    await send(action(position.source_id, "redeem", { token_id: position.token_id }), "Claiming your maturity payout");
  });
  const reconcile = listing => run("The pending delivery was resolved. Review the updated position and balance.", async send => {
    await send(action(environment.market, "reconcile", { listing_id: listing.id }, "0"), "Checking the source transfer receipt", { allowFalse: true });
    if (["Buying", "Canceling"].includes((await view(environment.market, "get_listing", { listing_id: listing.id }))?.status)) throw new Error("Delivery is still pending. Keep the receipt and check again later.");
  });

  const createLock = (amount, duration) => run("Demo lock created. You can now list its payout right.", async send => {
    const value = toUnits(amount);
    if (BigInt(value) > BigInt(await view(environment.token, "ft_balance_of", { account_id: account }))) throw new Error("Get enough test tokens before creating this demo lock.");
    const source = data.sources[0];
    if (!await view(source.id, "lock_credits", { owner_id: account })) await send(action(source.id, "prepay_lock", {}, source.storage_per_lock), "Preparing your demo position");
    await send(action(environment.token, "ft_transfer_call", { receiver_id: source.id, amount: value, msg: JSON.stringify({ action: "lock", duration }) }), "Creating a fixed-maturity demo lock");
  });

  async function reviewReceipt(item) {
    try {
      const result = await getOutcome(item.hash, item.signer);
      assertOutcome(result, { ...item.request, allowFalse: item.request.methodName === "reconcile" });
      setJournal(current => current.map(entry => entry.id === item.id ? { ...entry, state: "Confirmed", error: undefined } : entry));
      await latestRefresh.current?.();
      setNotice({ type: "success", message: "Receipt confirmed. Your positions and balances are refreshed.", receipt: item.receipt });
    } catch (error) { setNotice({ type: "error", message: error.message, receipt: item.receipt }); }
  }

  return { environment, account, data, loading, error, notice, setNotice, busy, progress, now, journal, refresh, reviewReceipt, connect, disconnect, faucet, withdraw, buy, list, cancel, redeem, reconcile, createLock, ready: data.ready && data.portfolioOwner === account && Boolean(account) && !busy };
}
