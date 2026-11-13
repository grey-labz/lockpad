export function Icon({ name, size = 20, ...props }) {
  const paths = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    northeast: <><path d="M6 18 18 6M6 6h12v12" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    back: <path d="M19 12H5m6-6-6 6 6 6" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    filter: <><path d="M4 7h16M4 17h16" /><circle cx="8" cy="7" r="2" /><circle cx="16" cy="17" r="2" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M17 11h4v5h-4a2.5 2.5 0 0 1 0-5ZM4 5l13-2" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4M8 14h2M14 14h2" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    refresh: <><path d="M20 10a8 8 0 0 0-14-4L3 9M3 4v5h5M4 14a8 8 0 0 0 14 4l3-3M21 20v-5h-5" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" /></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.lock}</svg>;
}

export function Logo() {
  return <span className="logo-mark" aria-hidden="true"><svg viewBox="0 0 28 32" fill="none"><path d="M8 13V9a6 6 0 0 1 12 0v4" stroke="currentColor" strokeWidth="2.2"/><rect x="3" y="12" width="22" height="17" rx="6" fill="currentColor"/><path d="M14 18v5" stroke="var(--onyx)" strokeWidth="2.4" strokeLinecap="round"/></svg></span>;
}
