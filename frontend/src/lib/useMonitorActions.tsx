import { useState } from 'react';
import { api } from '../api/client';
import type { Monitor } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';

type Pending = { kind: 'pause' | 'delete'; monitor: Monitor } | null;

/** Pause/resume/delete with confirmation dialogs and toast feedback. */
export function useMonitorActions(opts: { onChanged: (m: Monitor | null) => void }) {
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const resume = async (monitor: Monitor) => {
    try {
      const r = await api<{ monitor: Monitor }>(`/monitors/${monitor.id}/resume`, { method: 'POST' });
      toast.success(`${monitor.name} resumed — a check has been queued`);
      opts.onChanged(r.monitor);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === 'pause') {
        const r = await api<{ monitor: Monitor }>(`/monitors/${pending.monitor.id}/pause`, { method: 'POST' });
        toast.success(`${pending.monitor.name} paused`);
        opts.onChanged(r.monitor);
      } else {
        await api(`/monitors/${pending.monitor.id}`, { method: 'DELETE' });
        toast.success(`${pending.monitor.name} deleted`);
        opts.onChanged(null);
      }
      setPending(null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      busy={busy}
      danger={pending?.kind === 'delete'}
      title={pending?.kind === 'delete' ? 'Delete monitor?' : 'Pause monitor?'}
      message={
        pending?.kind === 'delete'
          ? `"${pending.monitor.name}" and all of its check history and incidents will be permanently deleted. This cannot be undone.`
          : `Checks for "${pending?.monitor.name}" will stop until you resume it. No alerts will be sent while paused.`
      }
      confirmLabel={pending?.kind === 'delete' ? 'Delete monitor' : 'Pause monitor'}
      onConfirm={confirm}
      onCancel={() => setPending(null)}
    />
  );

  return {
    askPause: (monitor: Monitor) => setPending({ kind: 'pause', monitor }),
    askDelete: (monitor: Monitor) => setPending({ kind: 'delete', monitor }),
    resume,
    dialog,
  };
}
