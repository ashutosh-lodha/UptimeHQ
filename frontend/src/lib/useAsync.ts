import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads data when `deps` change. Optional `refreshMs` re-fetches in the
 * background (without showing the loading state) so status stays current.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], refreshMs?: number): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const run = useCallback(async (background: boolean) => {
    const id = ++seq.current;
    if (!background) setLoading(true);
    try {
      const result = await fnRef.current();
      if (id === seq.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (id === seq.current && !background) setError(err as Error);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run(false);
    if (!refreshMs) return;
    const t = setInterval(() => void run(true), refreshMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(() => run(true), [run]);
  return { data, error, loading, reload };
}
