export function Loading({ text = 'Загрузка...' }: { text?: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: 200, gap: 12, color: 'var(--muted)',
    }}>
      <div style={{
        width: 32, height: 32, border: '3px solid rgba(122,162,255,0.2)',
        borderTopColor: '#7aa2ff', borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <span style={{ fontSize: 14 }}>{text}</span>
      <style dangerouslySetInnerHTML={{ __html: '@keyframes spin { to { transform: rotate(360deg); } }' }} />
    </div>
  );
}
