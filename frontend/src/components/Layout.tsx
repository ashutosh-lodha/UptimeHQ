import { useState, type ReactNode } from 'react';
import { Link, useRouter } from '../lib/router';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
  { to: '/monitors', label: 'Monitors', icon: 'M3 12h4l3-8 4 16 3-8h4' },
  { to: '/incidents', label: 'Incidents', icon: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' },
  { to: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2.2-1.3L14.4 3h-4l-.4 2.4a7 7 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2.2 1.3l.4 2.4h4l.4-2.4a7 7 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z' },
];

function isActive(path: string, to: string) {
  return to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`);
}

export function Layout({ children }: { children: ReactNode }) {
  const { path } = useRouter();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="shell">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28">
              <rect width="32" height="32" rx="8" fill="var(--accent)" />
              <path d="M6 17h5l3-7 4 13 3-6h5" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand-name">UptimeHQ</span>
          <button className="menu-toggle" onClick={() => setMenuOpen((o) => !o)} aria-label="Toggle navigation" aria-expanded={menuOpen}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d={menuOpen ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'} />
            </svg>
          </button>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={`nav-item ${isActive(path, n.to) ? 'active' : ''}`} onClick={() => setMenuOpen(false)} title={n.label}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={n.icon} />
              </svg>
              <span className="nav-label">{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip" title={user ? `${user.name} · ${user.email}` : undefined}>
            <div className="avatar" aria-hidden="true">
              {user?.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="user-meta">
              <div className="user-name">{user?.name}</div>
              <div className="user-email">{user?.email}</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-block" onClick={logout} title="Sign out" aria-label="Sign out">
            <span className="signout-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </span>
            <span className="signout-label">Sign out</span>
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
