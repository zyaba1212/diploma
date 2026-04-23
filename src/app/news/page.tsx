'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type NewsItem = {
  id: string;
  title: string;
  description: string | null;
  url: string;
  source: string;
  publishedAt: string | null;
};

export default function NewsPage() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/news?limit=30')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<NewsItem[]>;
      })
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="news-page" style={{ minHeight: '100vh', background: 'var(--bg)', padding: '72px 24px 40px' }}>
      <div className="news-page-inner" style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
          Новости технологий связи
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 28 }}>
          Актуальные новости в области телекоммуникаций, сетевой инфраструктуры и блокчейна
        </p>

        {loading && <p style={{ color: 'var(--muted)' }}>Загрузка…</p>}
        {error && <p style={{ color: 'var(--danger, #ff6b6b)' }}>Ошибка: {error}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {items.map((item) => (
            <a
              key={item.id}
              className="news-card"
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                textDecoration: 'none',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(232,236,255,0.10)',
                borderRadius: 4,
                padding: '18px 22px',
                transition: 'border-color 0.2s, background 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(120,160,255,0.3)';
                e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(232,236,255,0.10)';
                e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: '#8ab4f8', margin: 0, lineHeight: 1.4 }}>
                  {item.title}
                </h2>
                <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('ru-RU') : ''}
                </span>
              </div>
              {item.description && (
                <p style={{ fontSize: 13, color: 'rgba(200,220,255,0.7)', margin: '8px 0 0', lineHeight: 1.5 }}>
                  {item.description.length > 200 ? item.description.slice(0, 200) + '…' : item.description}
                </p>
              )}
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
                {item.source}
              </div>
            </a>
          ))}
        </div>

        {!loading && items.length === 0 && !error && (
          <p style={{ color: 'var(--muted)', textAlign: 'center', marginTop: 40 }}>
            Нет новостей по заданным критериям
          </p>
        )}

        <div style={{ marginTop: 32, textAlign: 'center' }}>
          <Link href="/" style={{ color: '#8ab4f8', textDecoration: 'none', fontSize: 14 }}>
            ← На главную
          </Link>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .news-page {
            padding: 72px 10px 40px !important;
          }
          .news-page-inner {
            max-width: 100% !important;
            width: 100%;
            box-sizing: border-box;
          }
          .news-card {
            width: 100% !important;
            max-width: 100%;
            box-sizing: border-box;
            padding: 14px 10px !important;
            min-width: 0;
          }
          .news-card h2 {
            word-break: break-word;
            overflow-wrap: anywhere;
            hyphens: auto;
          }
          .news-card p {
            word-break: break-word;
            overflow-wrap: anywhere;
          }
        }
      `}</style>
    </div>
  );
}
