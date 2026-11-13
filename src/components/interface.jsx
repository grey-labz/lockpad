import { useEffect, useId, useRef } from "react";
import { formatAmount, maturityDate, timeLeft, timestampMs, tradeMath } from "../lib/amounts.mjs";
import { Icon } from "./icon.jsx";

export function Amount({ value, className = "" }) {
  return <span className={`amount ${className}`}>{formatAmount(value)} <small>TUSD</small></span>;
}

export function Empty({ icon = "lock", title, children, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={25} /></span><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

export function PageHeading({ eyebrow, title, children, action }) {
  return <div className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1 tabIndex={-1}>{title}</h1>{children && <p className="page-description">{children}</p>}</div>{action}</div>;
}

export function Dialog({ title, children, close, busy = false, wide = false, error }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className={`dialog ${wide ? "dialog-wide" : ""}`} aria-labelledby={id} tabIndex={-1}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = [...ref.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')].filter(element => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); ref.current.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}
    onClick={event => {
      if (event.target !== ref.current || busy) return;
      const box = ref.current.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
    }}>
    <div className="dialog-heading"><h2 id={id}>{title}</h2><button className="icon-button" aria-label="Close dialog" disabled={busy} onClick={close}><Icon name="close" /></button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {children}
  </dialog>;
}

export function Status({ listing, now }) {
  const pending = ["Buying", "Canceling"].includes(listing.status);
  const text = listing.status === "Open" ? timestampMs(listing.unlock_at) <= now ? "Matured" : "Available"
    : listing.status === "Buying" ? "Purchase settling" : listing.status === "Canceling" ? "Return settling" : listing.status === "Sold" ? "Purchased" : "Listing removed";
  return <span className={`status ${pending ? "status-pending" : ""}`}><i />{text}</span>;
}

export function PositionCard({ listing, now }) {
  const math = tradeMath(listing.payout, listing.price);
  return <a className="position-card" href={`#/position/${encodeURIComponent(listing.id)}`} data-listing-id={listing.id}>
    <div className="card-top"><span className="token-icon"><Icon name="lock" size={21} /></span><Status listing={listing} now={now} /></div>
    <p className="card-source">Reference vault <span>#{listing.token_id}</span></p>
    <Amount value={listing.payout} className="card-payout" />
    <p className="card-label">Original payout at maturity</p>
    <div className="card-maturity"><Icon name="calendar" size={17} /><span>{maturityDate(listing.unlock_at)}</span><span>{timeLeft(listing.unlock_at, now)}</span></div>
    <div className="card-divider" />
    <div className="card-price"><div><span>Buy for</span><Amount value={listing.price} /></div><span className="discount-pill">{math.discount}% off</span></div>
    <div className="card-link">View position <Icon name="northeast" size={17} /></div>
  </a>;
}

export function Timeline({ createdAt, unlockAt, now }) {
  const start = timestampMs(createdAt), end = timestampMs(unlockAt);
  const progress = Math.min(100, Math.max(0, (now - start) / Math.max(1, end - start) * 100));
  return <div className="maturity-timeline">
    <div className="section-label"><span>Original maturity timeline</span><span>{timeLeft(unlockAt, now)}</span></div>
    <div className="timeline-track" role="progressbar" aria-label="Time until the original maturity" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
    <div className="timeline-dates"><div><span>Locked</span><strong>{maturityDate(createdAt, true)}</strong></div><div><span>Claim opens</span><strong>{maturityDate(unlockAt, true)}</strong></div></div>
    <p>Buying or selling keeps this date and the full payout unchanged.</p>
  </div>;
}
