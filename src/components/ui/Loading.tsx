export function Loading({ text = 'Загрузка...' }: { text?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 200,
        gap: 12,
        color: 'var(--muted)',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: `2px solid var(--border)`,
          borderTopColor: 'var(--accent)',
          borderRadius: 4,
        }}
      />
      <span style={{ fontSize: 14 }}>{text}</span>
    </div>
  );
}
