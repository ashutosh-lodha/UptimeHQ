import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel, danger, busy, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-msg">
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-msg">{message}</p>
        <div className="modal-actions">
          <button ref={cancelRef} className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
