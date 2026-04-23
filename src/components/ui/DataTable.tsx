'use client';

import { CSSProperties, ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  width?: number | string;
  align?: 'left' | 'right' | 'center';
}

export interface DataTableProps<T> {
  rows: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: ReactNode;
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
  fontSize: 13,
};

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  color: 'var(--muted)',
  fontWeight: 500,
  borderBottom: '1px solid var(--border)',
  position: 'sticky',
  top: 0,
  background: 'var(--panel)',
  zIndex: 1,
};

const tdStyle: CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text)',
  verticalAlign: 'middle',
};

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  error,
  emptyMessage,
  onRowClick,
  footer,
}: DataTableProps<T>) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--panel)' }}>
      <div style={{ maxHeight: 560, overflow: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{
                    ...thStyle,
                    textAlign: c.align ?? 'left',
                    width: c.width,
                  }}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td style={{ ...tdStyle, color: 'var(--danger)' }} colSpan={columns.length}>
                  {error}
                </td>
              </tr>
            ) : loading && rows.length === 0 ? (
              <tr>
                <td style={{ ...tdStyle, color: 'var(--muted)' }} colSpan={columns.length}>
                  Загрузка…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td style={{ ...tdStyle, color: 'var(--muted)' }} colSpan={columns.length}>
                  {emptyMessage ?? 'Нет данных'}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={{
                        ...tdStyle,
                        textAlign: c.align ?? 'left',
                      }}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer ? (
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 10px', fontSize: 12, color: 'var(--muted)' }}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}
