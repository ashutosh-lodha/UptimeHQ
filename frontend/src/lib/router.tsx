import { createContext, useCallback, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

/**
 * Minimal History-API router (no extra dependency). Supports path params
 * like `/monitors/:id` and query strings.
 */
interface RouterState {
  path: string;
  search: string;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterState | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(() => ({ path: window.location.pathname, search: window.location.search }));

  useEffect(() => {
    const onPop = () => setLoc({ path: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setLoc({ path: window.location.pathname, search: window.location.search });
    window.scrollTo(0, 0);
  }, []);

  return <RouterContext.Provider value={{ ...loc, navigate }}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterState {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used inside RouterProvider');
  return ctx;
}

/** Returns params when `pattern` matches `path`, otherwise null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.replace(/\/+$/, '').split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} {...rest} onClick={onClick}>
      {children}
    </a>
  );
}
