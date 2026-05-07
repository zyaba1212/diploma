'use client';

import { ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

export function ConfirmDialog({
  open,
  onClose,
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger,
  busy,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={Boolean(busy)}
      title={title}
      footer={
        <>
          <Button type="button" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={danger ? 'destructive' : 'outline'} loading={busy} onClick={() => void onConfirm()} disabled={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.5 }}>{message}</div>
    </Modal>
  );
}
