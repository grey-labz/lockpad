import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useLockpad } from "./hooks/use-lockpad.js";
import { localDemo, view } from "./lib/chain.mjs";
import { assertEligible, selectListings } from "./lib/market.mjs";
import { formatAmount, maturityDate, timeLeft, timestampMs, toUnits, tradeMath } from "./lib/amounts.mjs";
import { Icon, Logo } from "./components/icon.jsx";
import { Amount, Dialog, Empty, PageHeading, PositionCard, Status, Timeline } from "./components/interface.jsx";
import "./style.css";

const navigation = [["/marketplace", "Marketplace"], ["/sources", "How it works"], ["/positions", "My positions"], ["/activity", "Activity"]];
const termNames = { 60: "1 minute", 300: "5 minutes", 604800: "7 days", 2592000: "30 days", 7776000: "90 days" };
const navigate = path => { location.hash = path; };
const shortAccount = value => value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-9)}` : value;

function App() {
  const lp = useLockpad();
  const [route, setRoute] = useState(location.hash.slice(1) || "/");
  const [modal, setModal] = useState(null);
  const [salePosition, setSalePosition] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [detail, setDetail] = useState(null);
  const lookup = useRef(0);
  const detailId = route.match(/^\/position\/([^/]+)$/)?.[1];
  const activeRoute = route === "/portfolio" ? "/positions" : route;

  useEffect(() => {
    const change = () => {
      setRoute(location.hash.slice(1) || "/"); setMobileMenu(false); window.scrollTo(0, 0);
      requestAnimationFrame(() => document.querySelector("main h1")?.focus({ preventScroll: true }));
    };
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);

  useEffect(() => {
    const ticket = ++lookup.current;
    setDetail(null);
    if (!detailId || !lp.environment) return;
    if (!lp.data.ready) {
      if (!lp.loading) setDetail({ error: "This position cannot be loaded until the marketplace is connected." });
      return;
    }
    (async () => {
      const listing = await view(lp.environment.market, "get_listing", { listing_id: decodeURIComponent(detailId) });
      if (!listing) throw new Error("This listing was not found.");
      const position = await view(listing.source_id, "get_position", { token_id: listing.token_id });
      if (ticket === lookup.current) setDetail({ listing, position });
    })().catch(error => { if (ticket === lookup.current) setDetail({ error: error.message }); });
    return () => { lookup.current++; };
  }, [detailId, lp.environment, lp.data, lp.loading]);

  const openAccount = () => setModal({ kind: "account" });
  const ask = (kind, value) => setModal({ kind, ...value, signer: lp.account });
  const sell = position => { setSalePosition(position); setModal(null); navigate("/sell"); };
  const cards = selectListings(lp.data.listings, { now: lp.now });
  const close = () => setModal(null);
  const accountCurrent = lp.data.portfolioOwner === lp.account;
  const confirmDisabled = !lp.ready || modal?.signer !== lp.account;

  async function complete(operation, path) {
    if (confirmDisabled) return;
    if (await operation()) { close(); if (path) navigate(path); }
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById("main").focus(); }}>Skip to content</a>
    <header className="site-header">
      <a className="wordmark" href="#/" aria-label="Lockpad home"><Logo /><span>lockpad<span className="logo-dot">.</span></span></a>
      <nav className={mobileMenu ? "main-nav nav-open" : "main-nav"} aria-label="Main navigation">
        {navigation.map(([path, label]) => <a href={`#${path}`} key={path} aria-current={activeRoute === path ? "page" : undefined}>{label}</a>)}
      </nav>
      <div className="header-actions">
        <a className="button secondary sell-header" href="#/sell">Sell a position <Icon name="northeast" size={15} /></a>
        <button className="button wallet-button" disabled={lp.busy || (!localDemo && !lp.environment?.market)} onClick={openAccount} title={lp.account || undefined}>
          <Icon name="wallet" size={17} /><span>{lp.account ? shortAccount(lp.account) : localDemo ? "Choose test wallet" : "Connect wallet"}</span>
        </button>
        <button className="icon-button menu-button" aria-label="Toggle navigation" aria-expanded={mobileMenu} onClick={() => setMobileMenu(value => !value)}><Icon name={mobileMenu ? "close" : "menu"} /></button>
      </div>
    </header>
    <div className="network-bar"><span className="network-dot" /><span>{localDemo ? "Local NEAR Sandbox" : "NEAR testnet prototype"}</span><span className="network-separator">/</span><span>Test tokens have no monetary value</span>{lp.busy && <span className="transaction-progress" role="status"><span className="spinner" />{lp.progress}</span>}</div>
    <main id="main" tabIndex={-1}>
      {lp.error && <div className={`connection-banner ${lp.environment?.market ? "connection-error" : ""}`} role={lp.environment?.market ? "alert" : "status"}>
        <Icon name="info" size={18} /><span>{lp.error}</span>{lp.environment?.market && <button className="text-button" disabled={lp.busy} onClick={lp.refresh}>Retry connection</button>}
      </div>}
      {lp.notice && <aside className={`notice notice-${lp.notice.type}`} role={lp.notice.type === "error" ? "alert" : "status"}>
        <Icon name={lp.notice.type === "error" ? "info" : "check"} /><div>{lp.notice.message}{lp.notice.receipt && <a href={lp.notice.receipt} target="_blank" rel="noreferrer">View transaction receipt <Icon name="northeast" size={13} /></a>}</div>
        <button className="icon-button" onClick={() => lp.setNotice(null)} aria-label="Dismiss notification"><Icon name="close" size={17} /></button>
      </aside>}
      {activeRoute === "/" && <Home lp={lp} listings={cards} />}
      {activeRoute === "/marketplace" && <Marketplace lp={lp} />}
      {activeRoute === "/sources" && <Sources lp={lp} />}
      {activeRoute === "/positions" && <Portfolio lp={lp} current={accountCurrent} openAccount={openAccount} sell={sell} ask={ask} />}
      {activeRoute === "/sell" && <Sell lp={lp} prefill={salePosition} openAccount={openAccount} onReview={(position, price) => ask("list", { position, price })} />}
      {activeRoute === "/activity" && <Activity lp={lp} />}
      {detailId && <PositionDetail lp={lp} detail={detail} openAccount={openAccount} ask={ask} />}
      {!["/", "/marketplace", "/sources", "/positions", "/sell", "/activity"].includes(activeRoute) && !detailId && <Empty title="This page doesn't exist" action={<a className="button primary" href="#/">Back to Lockpad</a>}>Explore the marketplace to find a payout right.</Empty>}
    </main>
    <footer className="site-footer"><a className="wordmark" href="#/"><Logo /><span>lockpad.</span></a><p>Time stays locked. Ownership can move.</p><div><a href="#/sources">Payout rights & risks</a><a href="https://github.com/greyw0rks/timeshift" target="_blank" rel="noreferrer">Source <Icon name="northeast" size={13} /></a><span>{localDemo ? "Local contract demo" : "Testnet prototype"}</span></div></footer>

    {modal?.kind === "account" && <Dialog title={localDemo ? "Choose a local test wallet" : lp.account ? "Your wallet" : "Connect your wallet"} close={close} busy={lp.busy} error={lp.notice?.type === "error" ? lp.notice.message : undefined}>
      {localDemo ? <><p className="dialog-copy">These temporary wallets belong to this local demo. Their tokens and positions are real Sandbox contract state.</p><div className="wallet-list">
        {lp.environment?.accounts.map(account => <button className="wallet-option" key={account.accountId} onClick={async () => { if (await lp.connect(account.accountId)) close(); }}>
          <span className="wallet-avatar">{account.name[0]}</span><span><strong>{account.name}</strong><small>{account.role}</small><code>{account.accountId}</code></span>{lp.account === account.accountId ? <Icon name="check" /> : <Icon name="arrow" />}
        </button>)}
      </div></> : <p className="dialog-copy">{lp.account || "Use a NEAR testnet wallet to buy or sell a supported payout right."}</p>}
      {lp.account ? <button className="button secondary full-width" onClick={async () => { await lp.disconnect(); close(); }}>Disconnect wallet</button>
        : !localDemo && <button className="button primary full-width" onClick={async () => { if (await lp.connect()) close(); }}>Continue to NEAR wallet <Icon name="northeast" /></button>}
    </Dialog>}
    {modal?.kind === "buy" && <Dialog title="Buy this future payout" close={close} busy={lp.busy} error={lp.notice?.type === "error" ? lp.notice.message : undefined}>
      <PurchaseBreakdown listing={modal.listing} />
      <p className="dialog-copy">You receive the original payout right. Its principal stays in the reference vault until {maturityDate(modal.listing.unlock_at)}.</p>
      <div className="funding-note"><Icon name="shield" size={19} /><p>Your purchase uses your market balance first. Any additional funding remains in your recoverable market balance if the purchase fails. A pending delivery must be resolved before its reserved funds can be withdrawn.</p></div>
      <p className="fee-note">0.01 testnet NEAR for settlement storage{!lp.data.registered ? ", plus 0.03 for your first market account" : ""}. Wallet gas is separate. Storage charges are not refunded.</p>
      {modal.signer !== lp.account && <p className="form-error">Your wallet changed. Close this review and start again.</p>}
      <button className="button primary full-width" disabled={confirmDisabled} onClick={() => complete(() => lp.buy(modal.listing))}>{lp.busy ? lp.progress : `Confirm purchase · ${formatAmount(modal.listing.price)} TUSD`}<Icon name="arrow" size={17} /></button>
    </Dialog>}
    {modal?.kind === "list" && <Dialog title="Review your early exit" close={close} busy={lp.busy} error={lp.notice?.type === "error" ? lp.notice.message : undefined}>
      <PurchaseBreakdown listing={{ payout: modal.position.principal, price: modal.price }} />
      <p className="dialog-copy">Your payout NFT moves into the marketplace. The full principal stays in the reference vault, and its original maturity stays {maturityDate(modal.position.unlock_at)}. Proceeds become withdrawable only after a buyer receives the right.</p>
      <p className="fee-note">{lp.data.ledger.listing_credits ? "Your prepaid listing credit will be used." : "0.03 testnet NEAR for listing storage."}{!lp.data.registered && " Your first market account also needs 0.03 testnet NEAR."} Gas is separate. A later cancellation costs 0.01 testnet NEAR. Storage charges are not refunded.</p>
      <button className="button primary full-width" disabled={confirmDisabled} onClick={() => complete(() => lp.list(modal.position, modal.price), "/positions")}>{lp.busy ? lp.progress : "Confirm listing"}<Icon name="northeast" size={17} /></button>
    </Dialog>}
    {["cancel", "redeem", "withdraw"].includes(modal?.kind) && <Dialog title={modal.kind === "cancel" ? "Remove this listing?" : modal.kind === "redeem" ? "Claim your original payout" : modal.balanceKind === "proceeds" ? "Withdraw your sale proceeds" : "Return unused market funds"} close={close} busy={lp.busy} error={lp.notice?.type === "error" ? lp.notice.message : undefined}>
      <p className="dialog-copy">{modal.kind === "cancel" ? "The unsold payout right returns to your wallet. Your principal and maturity remain in the reference vault. Cancellation uses 0.01 testnet NEAR for transfer receipt storage."
        : modal.kind === "redeem" ? `The reference vault pays ${formatAmount(modal.position.principal)} TUSD to the current owner. This claim can be redeemed once.`
        : `${formatAmount(modal.value)} TUSD will move from the marketplace to your connected wallet. If the token transfer fails, your withdrawable balance is restored.`}</p>
      <p className="fee-note">Only test tokens are used. Wallet gas is separate.</p>
      <button className="button primary full-width" disabled={confirmDisabled} onClick={() => complete(() => modal.kind === "cancel" ? lp.cancel(modal.listing) : modal.kind === "redeem" ? lp.redeem(modal.position) : lp.withdraw(modal.balanceKind))}>{lp.busy ? lp.progress : modal.kind === "cancel" ? "Confirm removal" : modal.kind === "redeem" ? "Confirm maturity claim" : "Confirm withdrawal"}<Icon name="arrow" size={17} /></button>
    </Dialog>}
    {modal?.kind === "create" && <Dialog title="Create a reference test position" close={close} busy={lp.busy} error={lp.notice?.type === "error" ? lp.notice.message : undefined}><CreatePosition lp={lp} close={close} /></Dialog>}
  </div>;
}

function Home({ lp, listings }) {
  return <div className="landing">
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-symbol"><Logo /></div>
      <div className="floating-card floating-lock" aria-label="Illustrative locked position"><div className="float-top"><Icon name="lock" size={17} /><span>Example position</span></div><strong>1,000 <small>TUSD</small></strong><p>Locked for 30 days</p><span className="source-tag">Reference vault</span></div>
      <div className="floating-card floating-calendar"><Icon name="calendar" size={19} /><span className="float-caption">Original maturity</span><strong>Day 30</strong><p>Sale on day 15</p><div className="mini-calendar">{Array.from({ length: 14 }, (_, index) => <i className={index === 13 ? "calendar-selected" : ""} key={index} />)}</div></div>
      <div className="hero-copy"><p className="eyebrow"><span className="network-dot" /> A MARKETPLACE FOR LOCKED PAYOUTS</p><h1 id="hero-title" tabIndex={-1}>Your funds are locked.<br /><span>Your options aren’t.</span></h1><p>Get liquidity before your lock expires. Sell your payout right at a discount, or buy someone else’s future payout.</p><div className="hero-actions"><a className="button primary" href="#/marketplace">Explore the marketplace <Icon name="northeast" size={18} /></a><a className="text-link" href="#/sell">Sell a position <Icon name="arrow" size={17} /></a></div></div>
      <div className="floating-card floating-sale"><span className="float-caption">Seller receives early</span><strong>920 <small>TUSD</small></strong><p>A little less. A lot sooner.</p><span className="mini-flow"><Icon name="wallet" size={15} /> Day 15 <Icon name="arrow" size={14} /> Your wallet</span></div>
      <div className="floating-card floating-payout"><span className="float-caption">Buyer claims at maturity</span><strong>1,000 <small>TUSD</small></strong><p>8% discount · Original date</p><span className="example-label">Illustrative trade, not a live listing</span></div>
    </section>
    <div className="trust-strip"><span className="near-label"><span className="near-symbol">N</span> Built on NEAR</span><span><Icon name="shield" size={17} /> Ownership checked onchain</span><span><Icon name="calendar" size={17} /> Original maturity preserved</span><span><Icon name="lock" size={17} /> Principal stays in its vault</span></div>
    <section className="home-market"><div className="section-heading"><div><p className="eyebrow">{localDemo ? "FROM THE LOCAL CONTRACTS" : "THE MARKETPLACE"}</p><h2>A future payout. A price today.</h2><p>{localDemo ? "Actual positions from this isolated Sandbox run." : "Supported positions appear after their ownership and payout are checked."}</p></div><a className="text-link" href="#/marketplace">View marketplace <Icon name="arrow" size={17} /></a></div>
      {lp.loading ? <LoadingCards /> : listings.length ? <div className="position-grid">{listings.slice(0, 3).map(listing => <PositionCard listing={listing} now={lp.now} key={listing.id} />)}</div>
        : <Empty title="No available payout rights yet" action={<a className="button secondary" href="#/sources">See supported sources <Icon name="arrow" size={16} /></a>}>A position needs a verified transferable payout right before it can appear here.</Empty>}
    </section>
    <section className="how-section"><div className="section-heading"><div><p className="eyebrow">SAME LOCK. NEW POSSIBILITIES.</p><h2>Time stays. Ownership moves.</h2></div><p>Your future payout can change hands<br />without moving its maturity date.</p></div><Steps /></section>
    <section className="source-callout"><span className="callout-icon"><Icon name="shield" size={30} /></span><div><p className="eyebrow">ELIGIBLE RIGHTS ONLY</p><h2>Not every lock can be sold.</h2><p>The reference vault is supported. Third-party DeFi sources need their own verified transfer and payout adapter.</p></div><a className="button secondary" href="#/sources">Understand eligibility <Icon name="arrow" size={17} /></a></section>
  </div>;
}

function Steps() {
  return <div className="steps-grid">{[
    ["01", "An existing payout right", "The seller owns a supported fixed-maturity position. Its principal is already held by its source vault.", "lock"],
    ["02", "An early-exit price", "The seller lists the payout right below its principal. A buyer funds the price and receives the original NFT.", "wallet"],
    ["03", "The original payout", "After delivery, the seller withdraws the sale proceeds. At maturity, the buyer claims the full principal from its source.", "calendar"],
  ].map(([number, title, text, icon]) => <article className="step" key={number}><div><span>{number}</span><Icon name={icon} size={23} /></div><h3>{title}</h3><p>{text}</p></article>)}</div>;
}

function LoadingCards() {
  return <div className="position-grid" role="status" aria-label="Loading positions">{[1, 2, 3].map(value => <div className="skeleton-card" key={value}><span /><span /><span /></div>)}</div>;
}

function Marketplace({ lp }) {
  const [query, setQuery] = useState("");
  const [maturity, setMaturity] = useState("all");
  const [discount, setDiscount] = useState("all");
  const [sort, setSort] = useState("maturity");
  const listings = selectListings(lp.data.listings, { query, maturity, discount, sort, now: lp.now });
  const pending = lp.data.listings.filter(listing => ["Buying", "Canceling"].includes(listing.status));
  const reset = () => { setQuery(""); setMaturity("all"); setDiscount("all"); };
  const filtered = query || maturity !== "all" || discount !== "all";
  return <section className="inner-page">
    <PageHeading eyebrow="THE SECONDARY MARKET" title="Buy time at a discount." action={<a className="button primary" href="#/sell">Sell a position <Icon name="plus" size={17} /></a>}>Browse supported payout rights. Principal stays in its source; ownership changes hands.</PageHeading>
    <div className="market-toolbar"><label className="search-field"><Icon name="search" size={19} /><input aria-label="Search positions" placeholder="Search position, source or seller" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery("")}><Icon name="close" size={15} /></button>}</label>
      <label className="select-field"><span>Maturity</span><select aria-label="Filter by maturity" value={maturity} onChange={event => setMaturity(event.target.value)}><option value="all">Any maturity</option><option value="week">Within 7 days</option><option value="month">7–30 days</option><option value="later">After 30 days</option></select></label>
      <label className="select-field"><span>Discount</span><select aria-label="Filter by discount" value={discount} onChange={event => setDiscount(event.target.value)}><option value="all">Any discount</option><option value="5">5% or more</option><option value="10">10% or more</option></select></label>
    </div>
    <div className="results-line"><span aria-live="polite">{lp.loading ? "Checking available positions…" : `${listings.length} available position${listings.length === 1 ? "" : "s"}`}{localDemo && " · Local Sandbox"}</span><label>Sort by <select aria-label="Sort positions" value={sort} onChange={event => setSort(event.target.value)}><option value="maturity">Soonest maturity</option><option value="discount">Largest discount</option><option value="price">Lowest price</option></select></label></div>
    {lp.loading ? <LoadingCards /> : listings.length ? <div className="position-grid">{listings.map(listing => <PositionCard key={listing.id} listing={listing} now={lp.now} />)}</div>
      : <Empty icon={filtered ? "search" : "lock"} title={filtered ? "No positions match these filters" : "No available positions"} action={filtered ? <button className="button secondary" onClick={reset}>Reset filters</button> : <a className="button secondary" href="#/sources">Check source eligibility</a>}>{filtered ? "Try a different maturity, discount or search." : "Only checked, supported payout rights can be listed. No example cards are offered for sale."}</Empty>}
    {pending.length > 0 && <div className="pending-panel"><h2>Deliveries being resolved</h2>{pending.map(listing => <a key={listing.id} href={`#/position/${listing.id}`}>Reference position #{listing.token_id}<Status listing={listing} now={lp.now} /><Icon name="arrow" size={17} /></a>)}</div>}
    <p className="market-footnote">The discount is measured against principal. Gross return is measured against purchase price. Neither is an annualized yield or a guarantee. The market displays up to 100 current listings.</p>
  </section>;
}

function PurchaseBreakdown({ listing }) {
  const math = tradeMath(listing.payout, listing.price);
  return <div className="purchase-breakdown"><div><span>Price paid to the seller</span><Amount value={listing.price} /></div><div><span>Original payout at maturity</span><Amount value={listing.payout} /></div><div><span>Discount from principal</span><strong>{math.discount}%</strong></div><div className="breakdown-total"><span>Gross difference</span><div><Amount value={math.profit} /><small>{math.returnOnPrice}% of purchase price</small></div></div><p>Before gas and storage. No annualized yield or guaranteed return.</p></div>;
}

function PositionDetail({ lp, detail, openAccount, ask }) {
  if (!detail) return <section className="inner-page"><a className="back-link" href="#/marketplace"><Icon name="back" size={17} /> Marketplace</a><div className="loading-panel" role="status">Checking the listing and source ownership…</div></section>;
  if (detail.error) return <section className="inner-page"><Empty title="Position unavailable" action={<a className="button secondary" href="#/marketplace">Back to marketplace</a>}>{detail.error}</Empty></section>;
  const { listing, position } = detail;
  const mature = timestampMs(listing.unlock_at) <= lp.now;
  const seller = lp.account === listing.seller_id;
  const owner = Boolean(lp.account && position?.owner_id === lp.account);
  const pending = ["Buying", "Canceling"].includes(listing.status);
  return <section className="inner-page position-detail">
    <a className="back-link" href="#/marketplace"><Icon name="back" size={17} /> Marketplace</a>
    <PageHeading eyebrow={`REFERENCE VAULT / POSITION #${listing.token_id}`} title="One lock. The original payout." action={<Status listing={listing} now={lp.now} />}>The marketplace trades this position’s payout right. Its funds remain in the reference vault.</PageHeading>
    <div className="detail-grid"><div className="detail-main"><div className="payout-panel"><span className="token-icon"><Icon name="lock" size={28} /></span><span>Full payout at original maturity</span><Amount value={listing.payout} /><p>{maturityDate(listing.unlock_at, true)}</p></div>
      <Timeline createdAt={listing.source_created_at} unlockAt={listing.unlock_at} now={lp.now} />
      <div className="source-facts"><h2>Checked at the source</h2><dl><div><dt>Position source</dt><dd><code>{listing.source_id}</code></dd></div><div><dt>Original seller</dt><dd><code>{listing.seller_id}</code></dd></div><div><dt>Current payout owner</dt><dd><code>{position?.owner_id || "Not confirmed"}</code></dd></div><div><dt>Principal status</dt><dd>{position?.status === "Redeemed" ? "Claimed by its owner" : position?.status === "Redeeming" ? "Maturity payout settling" : "Held in the reference vault"}</dd></div></dl></div>
    </div><aside className="purchase-panel"><h2>{listing.status === "Sold" ? "Purchased payout right" : listing.status === "Cancelled" ? "Listing removed" : "An early-exit price"}</h2><PurchaseBreakdown listing={listing} />
      {pending ? <><p className="dialog-copy">Delivery is pending. Its reserved payment is kept separate until the source transfer is resolved.</p><p className="fee-note">Reconciliation opens after {maturityDate(listing.valid_until, true)}.</p><button className="button primary full-width" disabled={!lp.ready || timestampMs(listing.valid_until) >= lp.now} onClick={() => lp.reconcile(listing)}>Check pending delivery <Icon name="refresh" size={17} /></button></>
        : listing.status === "Open" ? seller ? <><p className="dialog-copy">{mature ? "This lock has matured. Remove the listing to return its payout right, then claim from My positions." : "This is your listing. Your sale proceeds become available after successful delivery to a buyer."}</p><button className="button secondary full-width" disabled={!lp.ready} onClick={() => ask("cancel", { listing })}>Remove listing</button></>
          : mature ? <p className="dialog-copy">This position has matured and is no longer available for purchase.</p>
            : !lp.account ? <button className="button primary full-width" onClick={openAccount} disabled={!lp.data.ready}>{localDemo ? "Choose a wallet to buy" : "Connect wallet to buy"}<Icon name="wallet" size={17} /></button>
              : <button className="button primary full-width" disabled={!lp.ready || position?.owner_id !== lp.environment?.market || position?.status !== "Active"} onClick={() => ask("buy", { listing })}>Review purchase <Icon name="arrow" size={17} /></button>
        : owner && position.status === "Active" && mature ? <button className="button primary full-width" disabled={!lp.ready} onClick={() => ask("redeem", { position: { ...position, source_id: listing.source_id } })}>Claim maturity payout <Icon name="arrow" size={17} /></button>
          : <><p className="dialog-copy">{owner ? position.status === "Redeemed" ? "You claimed this payout. The NFT remains as a historical receipt." : "You own this payout right. Claim from the source when its original maturity arrives." : "This payout right is no longer for sale."}</p><a className="button secondary full-width" href="#/positions">View my positions <Icon name="arrow" size={17} /></a></>}
      <div className="risk-note"><Icon name="info" size={17} /><p>This reference instrument has no yield strategy. The contracts are unaudited, retain upgrade keys, and carry contract and settlement risk.</p></div>
    </aside></div>
  </section>;
}

function Portfolio({ lp, current, openAccount, sell, ask }) {
  const holdings = current ? lp.data.holdings : [];
  const sellerListings = current ? lp.data.sellerListings.filter(listing => ["Open", "Buying", "Canceling"].includes(listing.status)) : [];
  const ledger = current ? lp.data.ledger : { available: "0", proceeds: "0" };
  return <section className="inner-page">
    <PageHeading eyebrow="YOUR PAYOUT RIGHTS" title="Your positions. Your next move." action={lp.account && <button className="button secondary" disabled={!lp.ready} onClick={() => ask("create", {})}><Icon name="plus" size={17} /> Create test position</button>}>List an eligible lock, claim a matured payout, or withdraw a completed sale.</PageHeading>
    {!lp.account ? <Empty icon="wallet" title="Connect to see your positions" action={<button className="button primary" disabled={!lp.data.ready} onClick={openAccount}>{localDemo ? "Choose a local test wallet" : "Connect wallet"}<Icon name="wallet" size={17} /></button>}>Your holdings and market balances are checked for the account you choose.</Empty>
      : !current || !lp.data.ready ? <div className="loading-panel" role="status">{lp.error ? "Your balances are unavailable until the connection is restored." : "Checking your positions and balances…"}</div>
        : <><div className="balances-grid">
          <article className="balance-card"><span><Icon name="wallet" size={17} /> Wallet balance</span><Amount value={lp.data.tokenBalance} /><button className="text-button" disabled={!lp.ready} onClick={lp.faucet}>Get test tokens <Icon name="plus" size={15} /></button></article>
          <article className="balance-card"><span><Icon name="shield" size={17} /> Unused market funds</span><Amount value={ledger.available} /><button className="text-button" disabled={!lp.ready || BigInt(ledger.available) === 0n || Boolean(ledger.withdrawal)} onClick={() => ask("withdraw", { balanceKind: "balance", value: ledger.available })}>Return to wallet <Icon name="arrow" size={15} /></button></article>
          <article className="balance-card"><span><Icon name="check" size={17} /> Sale proceeds</span><Amount value={ledger.proceeds} /><button className="text-button" disabled={!lp.ready || BigInt(ledger.proceeds) === 0n || Boolean(ledger.withdrawal)} onClick={() => ask("withdraw", { balanceKind: "proceeds", value: ledger.proceeds })}>Withdraw proceeds <Icon name="arrow" size={15} /></button></article>
        </div>{ledger.withdrawal && <p className="connection-banner" role="status">A withdrawal is pending. Inspect its receipt in Activity before taking another payout action.</p>}
        <div className="section-heading compact-heading"><h2>In your wallet <span className="count-pill">{holdings.length}</span></h2><button className="text-button" disabled={lp.busy} onClick={lp.refresh}><Icon name="refresh" size={16} /> Refresh positions</button></div>
        {holdings.length ? <div className="holdings-list">{holdings.map(position => <article className="holding-row" data-position-id={position.token_id} key={`${position.source_id}:${position.token_id}`}><span className="token-icon"><Icon name="lock" size={20} /></span><div className="holding-info"><strong>Reference position #{position.token_id}</strong><span>{position.status === "Redeemed" ? "Payout claimed" : position.status === "Redeeming" ? "Maturity payout settling" : timeLeft(position.unlock_at, lp.now)} · {maturityDate(position.unlock_at)}</span></div><Amount value={position.principal} />
          {position.status === "Active" && !position.transfer_pending ? timestampMs(position.unlock_at) <= lp.now ? <button className="button primary" disabled={!lp.ready} onClick={() => ask("redeem", { position })}>Claim payout <Icon name="arrow" size={16} /></button>
            : <button className="button secondary" disabled={!lp.ready} onClick={() => sell(position)}>List position <Icon name="northeast" size={16} /></button>
            : <span className="status">{position.status === "Redeemed" ? "Redeemed" : "Settling"}</span>}
        </article>)}</div> : <Empty title="No payout rights in this wallet" action={<a className="button secondary" href="#/marketplace">Explore the marketplace</a>}>Purchase a supported position or create a reference test position for this demo.</Empty>}
        {sellerListings.length > 0 && <><div className="section-heading compact-heading"><h2>Your listings <span className="count-pill">{sellerListings.length}</span></h2><p>The marketplace holds these payout rights.</p></div><div className="position-grid">{sellerListings.map(listing => <PositionCard key={listing.id} listing={listing} now={lp.now} />)}</div></>}
        </>}
  </section>;
}

function Sell({ lp, prefill, openAccount, onReview }) {
  const [selected, setSelected] = useState(null);
  const [price, setPrice] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [importError, setImportError] = useState("");
  const [checking, setChecking] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++; setPrice(""); setImportError(""); setChecking(false);
    setSelected(prefill?.owner_id === lp.account ? prefill : null);
    return () => { generation.current++; };
  }, [lp.account, prefill]);
  let quote, priceError;
  if (price && selected) try { quote = tradeMath(selected.principal, toUnits(price)); } catch (error) { priceError = error.message; }
  const eligible = lp.data.portfolioOwner === lp.account ? lp.data.holdings.filter(position => position.status === "Active" && !position.transfer_pending && timestampMs(position.unlock_at) > lp.now) : [];

  async function checkPosition(event) {
    event.preventDefault(); const ticket = ++generation.current; setChecking(true); setImportError("");
    try {
      const position = await view(lp.environment.vault, "get_position", { token_id: tokenId.trim() });
      const found = assertEligible(position, lp.environment.vault, lp.account, lp.environment, lp.now);
      if (ticket === generation.current) { setSelected(found); setPrice(""); }
    } catch (error) { if (ticket === generation.current) setImportError(error.message); }
    finally { if (ticket === generation.current) setChecking(false); }
  }

  return <section className="inner-page">
    <PageHeading eyebrow="YOUR EARLY EXIT" title="Sell the payout. Keep its promise.">Offer an existing supported payout right below its principal. The buyer gets its full payout at the original maturity.</PageHeading>
    {!lp.account ? <Empty icon="wallet" title="Choose the wallet that owns the position" action={<button className="button primary" disabled={!lp.data.ready} onClick={openAccount}>{localDemo ? "Choose a local test wallet" : "Connect wallet"}<Icon name="wallet" size={17} /></button>}>The marketplace checks your ownership with the originating vault.</Empty>
      : <div className="sell-grid"><div className="sell-select-panel"><div className="section-heading"><h2>1. Choose a payout right</h2></div><div className="position-options">
        {eligible.map(position => <button className={`position-option ${selected?.token_id === position.token_id ? "selected" : ""}`} key={`${position.source_id}:${position.token_id}`} disabled={!lp.ready || checking} onClick={() => { setSelected(position); setPrice(""); setImportError(""); }}>
          <span className="token-icon"><Icon name="lock" size={19} /></span><span><strong>Reference position #{position.token_id}</strong><small>{formatAmount(position.principal)} TUSD · {timeLeft(position.unlock_at, lp.now)}</small></span><span className="radio-indicator">{selected?.token_id === position.token_id && <i />}</span>
        </button>)}
        {!eligible.length && <p className="dialog-copy">No eligible positions were found in this wallet. Import a position ID to check it directly, or create a reference test position in My positions.</p>}
      </div><div className="import-panel"><h3>Have a position ID?</h3><p>Only the configured reference vault is supported.</p><form onSubmit={checkPosition}><label>Position ID<input required maxLength={64} value={tokenId} onChange={event => setTokenId(event.target.value)} placeholder="For example, 1" disabled={!lp.ready || checking} /></label><button className="button secondary" disabled={!lp.ready || checking}>{checking ? "Checking ownership…" : "Check position"}<Icon name="search" size={16} /></button></form>{importError && <p className="form-error" role="alert">{importError}</p>}</div></div>
        <div className="sell-price-panel"><h2>2. Set your sale price</h2>{selected ? <><div className="selected-summary"><span>Reference position #{selected.token_id}</span><Amount value={selected.principal} /><small>Original payout · {maturityDate(selected.unlock_at)}</small></div><form onSubmit={event => { event.preventDefault(); if (quote) onReview(selected, toUnits(price)); }}>
          <label className="amount-field">Price you receive from a buyer<div><input aria-label="Sale price" value={price} onChange={event => setPrice(event.target.value)} placeholder="0.00" inputMode="decimal" autoComplete="off" disabled={!lp.ready} /><span>TUSD</span></div></label>
          {priceError && <p className="form-error" role="alert">{priceError}</p>}
          {quote && <div className="quote-summary"><div><span>Discount from principal</span><strong>{quote.discount}%</strong></div><div><span>Buyer’s gross difference</span><strong>{formatAmount(quote.profit)} TUSD</strong></div><p>{quote.returnOnPrice}% of the purchase price, before gas and storage.</p></div>}
          <button className="button primary full-width" disabled={!lp.ready || !quote}>Review listing <Icon name="arrow" size={17} /></button>
        </form><p className="fee-note">Listing transfers the payout NFT into escrow. Your principal remains at its source. Proceeds require a completed buyer delivery; a listing does not guarantee a sale.</p></>
          : <Empty icon="wallet" title="Select your position">Its principal and original maturity will appear here.</Empty>}</div></div>}
  </section>;
}

function CreatePosition({ lp, close }) {
  const [amount, setAmount] = useState("");
  const [duration, setDuration] = useState(300);
  const [error, setError] = useState("");
  const signer = useRef(lp.account);
  return <><p className="dialog-copy">This separate reference vault holds your test principal and issues a fixed-maturity payout NFT. It has no yield strategy.</p><form onSubmit={async event => {
    event.preventDefault(); setError("");
    try { toUnits(amount); if (signer.current !== lp.account) throw new Error("Your wallet changed. Start again with the current account."); if (await lp.createLock(amount, duration)) close(); }
    catch (error) { setError(error.message); }
  }}><label className="amount-field">Test principal<div><input aria-label="Test principal" inputMode="decimal" autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} placeholder="100" required disabled={lp.busy} /><span>TUSD</span></div></label><label className="term-field">Fixed term<select aria-label="Lock term" value={duration} onChange={event => setDuration(Number(event.target.value))} disabled={lp.busy}>{lp.data.sources[0]?.terms.map(term => <option value={term} key={term}>{termNames[term] || `${term} seconds`}</option>)}</select></label>
    <p className="fee-note">0.03 testnet NEAR for position storage unless you have a prepaid credit. Gas is separate. Storage charges are not refunded.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary full-width" disabled={!lp.ready || signer.current !== lp.account}>{lp.busy ? lp.progress : "Create test position"}<Icon name="plus" size={17} /></button></form></>;
}

function Activity({ lp }) {
  const recent = [...lp.data.activity].reverse();
  const journal = lp.journal.filter(item => !lp.account || item.signer === lp.account);
  return <section className="inner-page">
    <PageHeading eyebrow="A RECORD YOU CAN CHECK" title="Every move leaves a receipt." action={localDemo && <a className="button secondary" href="/api/demo/evidence" target="_blank" rel="noreferrer">View this run’s receipts <Icon name="receipt" size={17} /></a>}>Completed market transfers and this browser’s wallet actions. Local Sandbox activity is a builder test, not independent adoption.</PageHeading>
    <div className="section-heading compact-heading"><h2>Wallet actions</h2><span className="subtle">{lp.account ? shortAccount(lp.account) : "This browser"}</span></div>
    {journal.length ? <div className="activity-list">{journal.map(item => <article className="activity-row" key={item.id}><span className="activity-icon"><Icon name={item.state === "Confirmed" ? "check" : "receipt"} size={20} /></span><div className="activity-copy"><strong>{item.label}</strong><small>{item.signer} · {new Date(item.createdAt).toLocaleString("en-US")}</small>{item.error && <p>{item.error}</p>}</div><span className={`status ${item.state === "Confirmed" ? "" : "status-pending"}`}>{item.state}</span><div className="activity-actions">{item.hash && item.state !== "Confirmed" && <button className="text-button" disabled={lp.busy} onClick={() => lp.reviewReceipt(item)}>Check receipt</button>}{item.receipt && <a className="text-link" href={item.receipt} target="_blank" rel="noreferrer">Receipt <Icon name="northeast" size={15} /></a>}</div></article>)}</div>
      : <Empty icon="receipt" title="No wallet actions recorded here">Your approvals and transaction receipts will appear after you take an action. Reloading does not replay transactions.</Empty>}
    <div className="section-heading compact-heading"><h2>Completed market transfers</h2><span className="subtle">Read from the market contract</span></div>
    {recent.length ? <div className="activity-list">{recent.map(listing => <a className="activity-row market-activity" key={listing.id} href={`#/position/${listing.id}`}><span className="activity-icon"><Icon name={listing.status === "Sold" ? "check" : "back"} size={20} /></span><div className="activity-copy"><strong>Reference position #{listing.token_id}</strong><small>{listing.status === "Sold" ? `${listing.seller_id} → ${listing.buyer_id}` : `Returned to ${listing.seller_id}`}</small></div><Amount value={listing.price} /><Status listing={listing} now={lp.now} /><Icon name="northeast" size={17} /></a>)}</div>
      : <Empty icon="receipt" title="No completed transfers yet">Listings and illustrative trade examples do not count as completed sales.</Empty>}
  </section>;
}

function Sources({ lp }) {
  return <section className="inner-page sources-page">
    <PageHeading eyebrow="WHAT YOU’RE ACTUALLY BUYING" title="A payout right, with rules attached.">A transferable NFT is useful only when its owner can execute the original claim. The source contract defines that right.</PageHeading>
    <Steps />
    <div className="section-heading compact-heading"><h2>Source eligibility</h2><span className="subtle">One verified reference adapter</span></div>
    <div className="source-list"><article className="source-entry"><span className="source-entry-icon"><Icon name="lock" size={25} /></span><div><h3>Separate reference vault</h3><p>A fixed principal, an original maturity, and a transferable NEP-171 payout NFT. The marketplace checks the authoritative source and accepts only its configured payment token.</p>{lp.environment?.vault && <code>{lp.environment.vault}</code>}</div><span className="status">{lp.data.ready ? "Supported in this run" : "Reference adapter"}</span></article>
      <article className="source-entry"><span className="source-entry-icon"><Icon name="shield" size={25} /></span><div><h3>Rhea and other locked DeFi positions</h3><p>Not integrated. Each specific position needs proof of seller authority, transferability under its locker rules, payout execution, and payment recovery. A protocol’s ordinary NFT transfer support alone is insufficient.</p></div><span className="status status-muted">Verification required</span></article>
      <article className="source-entry"><span className="source-entry-icon"><Icon name="info" size={25} /></span><div><h3>Creator fees and account-bound locks</h3><p>Fee reassignment is a different right from locked principal. An account-bound or administrator-controlled lock cannot be sold by an ordinary owner through this marketplace.</p></div><span className="status status-muted">Not supported</span></article>
    </div>
    <section className="risk-section"><h2>Know the limits before a purchase.</h2><div className="risk-grid"><article><h3>Discounts are not a guarantee</h3><p>A 1,000 TUSD payout bought for 920 has an 8% discount and an 8.70% gross return on price. Gas and storage reduce the difference. Neither figure is annualized.</p></article><article><h3>Delivery and payment have recovery rules</h3><p>Funding is deposited before purchase. Seller proceeds are released only after NFT delivery. An unresolved delivery keeps funds reserved until the source receipt is reconciled after its deadline.</p></article><article><h3>This is an unaudited prototype</h3><p>Only test tokens are supported. Contracts retain upgrade keys. Ordinary failed token transfers restore balances, but an arbitrary callback failure can leave a withdrawal or maturity claim pending and require technical recovery.</p></article></div></section>
    <a className="button primary" href="#/marketplace">Explore supported positions <Icon name="arrow" size={17} /></a>
  </section>;
}

createRoot(document.getElementById("root")).render(<App />);
