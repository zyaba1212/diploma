'use client';

import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';

export function CopyButton({
  value,
  label = 'Копировать',
  copiedLabel = 'Скопировано',
  compact,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  /** Узкая кнопка только с иконкой/коротким текстом */
  compact?: boolean;
}) {
  const [ok, setOk] = useState(false);

  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setOk(true);
      window.setTimeout(() => setOk(false), 2000);
    } catch {
      setOk(false);
    }
  }, [value]);

  return (
    <Button type="button" onClick={() => void onClick()} style={compact ? { padding: '4px 8px', fontSize: 12 } : undefined}>
      {ok ? `✓ ${copiedLabel}` : label}
    </Button>
  );
}
