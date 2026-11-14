import { useEffect, useRef, useState } from "react";
import { Amount, Empty, PageHeading, Timeline } from "./components/interface.jsx";
import { Icon } from "./components/icon.jsx";
import { localDemo, view } from "./lib/chain.mjs";
import { assertEligible } from "./lib/market.mjs";
import { formatAmount, maturityDate, timestampMs, toUnits } from "./lib/amounts.mjs";
import { loanMath, loanState } from "./lib/lending.mjs";

export function Borrow({ lp, prefill, openAccount, onReview, sell }) {
  const [selected, setSelected] = useState(null);
  const [offer, setOffer] = useState(null);
  const [amount, setAmount] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const current = lp.account && lp.data.portfolioOwner === lp.account;
  const eligible = current ? lp.data.holdings.filter(position => position.status === "Active" && !position.transfer_pending && timestampMs(position.unlock_at) > lp.now) : [];
  useEffect(() => { setSelected(prefill?.owner_id === lp.account ? prefill : null); setAmount(""); setOffer(null); }, [lp.account, prefill]);
  useEffect(() => {
    const ticket = ++request.current;
    setOffer(null); setError("");
    if (!selected || !lp.environment?.pool || !lp.data.poolConfig || !lp.account) { setChecking(false); return; }
    setChecking(true);
    (async () => {
      const source = await view(selected.source_id, "get_position", { token_id: selected.token_id });
      const position = assertEligible(source, selected.source_id, lp.account, lp.environment, lp.now);
      const quote = await view(lp.environment.pool, "get_quote", { principal: position.principal, unlock_at: position.unlock_at });
      if (ticket !== request.current) return;
      if (!quote.eligible) throw new Error("The pool cannot offer a loan against this position right now. You can consider listing it for sale.");
      setOffer({ position, quote });
      setAmount(value => value || formatAmount(quote.maximum).replaceAll(",", ""));
    })().catch(error => { if (ticket === request.current) setError(error.message); }).finally(() => { if (ticket === request.current) setChecking(false); });
    return () => { request.current++; };
  }, [selected?.source_id, selected?.token_id, lp.account, lp.environment?.pool, lp.data.poolConfig?.quote_nonce]);
  let math, amountError;
  if (offer && amount) try { math = loanMath(offer.position.principal, toUnits(amount), { ltvBps: lp.data.poolConfig.ltv_bps, feeBps: lp.data.poolConfig.fee_bps, liquidity: offer.quote.available_liquidity }); } catch (error) { amountError = error.message; }
  const choose = position => { setSelected(position); setAmount(""); setError(""); };
  return <section className="inner-page borrow-page">
    <PageHeading eyebrow="BORROW OR SELL" title="Your position. Your choice.">See what a funded pool can offer against your locked payout. If the amount does not suit you, choose your own sale price instead.</PageHeading>
    {!lp.account ? <Empty icon="wallet" title="Start with the wallet that owns your position" action={<button className="button primary" disabled={!lp.data.ready} onClick={openAccount}>{localDemo ? "Choose a test wallet" : "Connect wallet"}<Icon name="wallet" size={17} /></button>}>The source, payout, ownership, and original maturity are checked before a borrowing offer is available.</Empty>
      : !current || !lp.data.ready ? <div className="loading-panel" role="status">Checking your positions…</div>
        : !lp.environment?.pool || !lp.data.poolConfig ? <Empty title="The lending pool is not connected" action={<a className="button secondary" href="#/sources">View the prototype scope</a>}>This build has no configured pool. Borrowing stays unavailable until its source and funding can be verified.</Empty>
          : <div className="borrow-grid"><div className="borrow-select"><div className="panel-heading"><span className="step-number">01</span><h2>Choose your locked position</h2></div>
            {eligible.length ? <div className="position-options">{eligible.map(position => <button className={`position-option ${selected?.token_id === position.token_id && selected?.source_id === position.source_id ? "selected" : ""}`} key={`${position.source_id}:${position.token_id}`} disabled={lp.busy} onClick={() => choose(position)}><Icon name="lock" size={20} /><span><strong>Reference position #{position.token_id}</strong><small>Original maturity · {maturityDate(position.unlock_at, true)}</small></span><Amount value={position.principal} /><Icon name={selected?.token_id === position.token_id ? "check" : "arrow"} size={16} /></button>)}</div>
              : <Empty title="No eligible position in this wallet" action={<a className="button secondary" href="#/positions">View my positions</a>}>A payout right must still be active and in your wallet. Listed rights and existing loan collateral are unavailable for another loan.</Empty>}
            {offer && <div className="borrow-source"><h3>The lock stays where it is.</h3><p>The principal stays in the reference vault. Only the payout right is held as collateral.</p><Timeline createdAt={offer.position.created_at} unlockAt={offer.position.unlock_at} now={lp.now} /></div>}
            <div className="borrow-eligibility"><Icon name="shield" size={19} /><p>Non-transferable DEX positions need a supported way to secure their payout right. The current prototype supports the reference vault.</p></div>
          </div><aside className="borrow-offer"><div className="offer-heading"><span className="eyebrow">FUNDED POOL OFFER</span><span className="prototype-pill">Prototype terms</span></div>
            {checking ? <div className="loading-panel" role="status">Checking your source and the pool’s available funds…</div>
              : offer ? <><p className="offer-label">Available to borrow</p><Amount className="offer-maximum" value={offer.quote.maximum} /><p className="offer-explanation">Up to {lp.data.poolConfig.ltv_bps / 100}% of this position’s fixed payout, bounded by available pool liquidity.</p>
                <label className="amount-field">Amount to borrow<div><input aria-label="Amount to borrow" inputMode="decimal" autoComplete="off" value={amount} disabled={lp.busy} onChange={event => setAmount(event.target.value)} /><span>TUSD</span><button className="text-button" type="button" disabled={lp.busy} onClick={() => setAmount(formatAmount(offer.quote.maximum).replaceAll(",", ""))}>Max</button></div></label>
                <div className="quote-summary"><div><span>One-time fee · {lp.data.poolConfig.fee_bps / 100}%</span><Amount value={math?.fee || "0"} /></div><div><span>Repay by</span><strong>{maturityDate(offer.position.unlock_at, true)}</strong></div><div className="repayment-total"><span>Total to repay</span><Amount value={math?.repayment || "0"} /></div></div>
                {amountError && <p className="form-error" role="alert">{amountError}</p>}
                <button className="button primary full-width" disabled={!lp.ready || !math || timestampMs(offer.position.unlock_at) <= lp.now} onClick={() => onReview(offer.position, math.amount, offer.quote)}>Review borrowing offer<Icon name="arrow" size={17} /></button>
                <p className="borrow-risk">Repay before the original maturity to recover your payout right. If unpaid, the pool claims the source payout, retains the amount due, and returns the remainder to you.</p></>
                : <div className="offer-empty"><Icon name="wallet" size={29} /><h3>{error ? "No offer available" : "Your offer starts with a position."}</h3><p>{error || "Choose an eligible payout right to see a live quote from the local lending pool."}</p></div>}
            {selected && <div className="sale-alternative"><div><Icon name="northeast" size={20} /><strong>Need more than the pool offers?</strong></div><p>List the payout right on the marketplace at your chosen price. A buyer is needed to complete a sale.</p><button className="button secondary full-width" disabled={!lp.ready} onClick={() => sell(selected)}>List this position instead<Icon name="northeast" size={17} /></button></div>}
          </aside></div>}
  </section>;
}

export function LoanList({ lp, ask }) {
  if (!lp.account || lp.data.portfolioOwner !== lp.account || !lp.data.loans.length) return null;
  return <section className="loans-section"><div className="section-heading compact-heading"><div><p className="eyebrow">BORROWING</p><h2>Your loans & collateral <span className="count-pill">{lp.data.loans.length}</span></h2></div><a className="text-link" href="#/borrow">View borrowing offers <Icon name="arrow" size={16} /></a></div><div className="loan-list">{lp.data.loans.map(loan => {
    const state = loanState(loan, lp.now), expired = timestampMs(loan.valid_until) < lp.now;
    return <article className="loan-card" data-loan-id={loan.id} key={loan.id}><div className="loan-card-heading"><span className="token-icon"><Icon name="lock" size={20} /></span><div><h3>Loan against position #{loan.token_id}</h3><p>Original maturity · {maturityDate(loan.unlock_at, true)}</p></div><span className={`status loan-status loan-status-${loan.status.toLowerCase()}`}>{state.label}</span></div>
      <dl className="loan-numbers"><div><dt>Borrowed</dt><dd><Amount value={loan.amount} /></dd></div><div><dt>One-time fee</dt><dd><Amount value={loan.fee} /></dd></div><div><dt>Amount due</dt><dd><Amount value={loan.repay_amount} /></dd></div><div><dt>Source payout</dt><dd><Amount value={loan.collateral} /></dd></div></dl>
      <div className="loan-card-bottom"><p>{loan.status === "Repaid" ? "Repaid in full. The original payout right returned to your wallet." : loan.status === "Settled" ? `${formatAmount(BigInt(loan.collateral) - BigInt(loan.repay_amount))} TUSD of the source payout was credited to you after the amount due was retained.` : loan.status === "Cancelled" ? "The undrawn loan was cancelled and its collateral returned." : "The principal and original maturity remain in the source vault."}</p><div className="loan-actions">
        {loan.status === "Active" && <button className="button primary" disabled={!lp.ready} onClick={() => ask(state.mature ? "settleLoan" : "repayLoan", { loan })}>{state.mature ? "Settle at maturity" : `Repay ${formatAmount(loan.repay_amount)} TUSD`}<Icon name="arrow" size={16} /></button>}
        {loan.status === "CollateralReady" && <><button className="button secondary" disabled={!lp.ready} onClick={() => ask("cancelLoan", { loan })}>Return collateral</button>{!state.mature && <button className="button primary" disabled={!lp.ready} onClick={() => ask("drawLoan", { loan })}>Receive reserved loan</button>}</>}
        {loan.status === "RepaymentReady" && <button className="button primary" disabled={!lp.ready} onClick={() => ask("releaseLoan", { loan })}>Return repaid collateral</button>}
        {["Checking", "Returning", "Settling"].includes(loan.status) && <button className="button secondary" disabled={!lp.ready || (loan.status !== "Settling" && !expired)} onClick={() => lp.reconcileLoan(loan)}>Check pending loan<Icon name="refresh" size={16} /></button>}
        {loan.status === "Disbursing" && <a className="text-link" href="#/activity">Inspect payment receipt<Icon name="arrow" size={16} /></a>}
      </div></div></article>;
  })}</div></section>;
}

export function BorrowBreakdown({ position, amount, terms }) {
  const math = loanMath(position.principal, amount, { ltvBps: terms.ltv_bps, feeBps: terms.fee_bps });
  return <div className="purchase-breakdown"><div><span>You receive now</span><Amount value={amount} /></div><div><span>One-time fee · {terms.fee_bps / 100}%</span><Amount value={math.fee} /></div><div><span>Original source payout</span><Amount value={position.principal} /></div><div className="breakdown-total"><span>Total to repay</span><Amount value={math.repayment} /></div></div>;
}
