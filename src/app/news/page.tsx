'use client';

import type { CSSProperties } from 'react';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type NewsItem = {
  id: string;
  title: string;
  description: string | null;
  url: string;
  source: string;
  publishedAt: string | null;
};

type NewsApiResponse = {
  items: NewsItem[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 30;

function buildVisiblePages(totalPages: number, page: number): (number | 'ellipsis')[] {
  if (totalPages <= 9) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set<number>();
  pages.add(1);
  pages.add(totalPages);
  for (let p = page - 2; p <= page + 2; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | 'ellipsis')[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push('ellipsis');
    out.push(p);
    prev = p;
  }
  return out;
}

function NewsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const pageFromUrl = Math.max(1, Math.floor(Number(searchParams.get('page')) || 1));

  const [items, setItems] = useState<NewsItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(pageFromUrl);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(pageFromUrl);
  }, [pageFromUrl]);

  const setUrlPage = useCallback(
    (p: number) => {
      const next = new URLSearchParams(searchParams.toString());
      if (p <= 1) next.delete('page');
      else next.set('page', String(p));
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      days: '3',
    });

    fetch(`/api/news?${qs}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<NewsApiResponse>;
      })
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.total);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, pageSize]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const showPager = totalPages > 1;
  const visiblePages = useMemo(() => buildVisiblePages(totalPages, page), [totalPages, page]);

  const goToPage = (p: number) => {
    const next = Math.min(Math.max(1, p), totalPages);
    setPage(next);
    setUrlPage(next);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const btnStyle = (active: boolean): CSSProperties => ({
    minWidth: 36,
    height: 36,
    padding: '0 10px',
    borderRadius: 4,
    border: `1px solid ${active ? 'rgba(120,160,255,0.45)' : 'rgba(232,236,255,0.15)'}`,
    background: active ? 'rgba(120,160,255,0.15)' : 'rgba(255,255,255,0.04)',
    color: active ? '#b8c9ff' : 'var(--muted)',
    cursor: 'pointer',
    fontSize: 13,
  });

  return (
    <div className="news-page" style={{ minHeight: '100vh', background: 'var(--bg)', padding: '72px 24px 40px' }}>
      <div className="news-page-inner" style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
          Новости технологий связи
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 12 }}>
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
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    minWidth: '6.5em',
                    textAlign: 'right',
                  }}
                >
                  {item.publishedAt
                    ? new Date(item.publishedAt).toLocaleDateString('ru-RU')
                    : '—'}
                </span>
              </div>
              {item.description && (
                <p style={{ fontSize: 13, color: 'rgba(200,220,255,0.7)', margin: '8px 0 0', lineHeight: 1.5 }}>
                  {item.description.length > 200 ? item.description.slice(0, 200) + '…' : item.description}
                </p>
              )}
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>{item.source}</div>
            </a>
          ))}
        </div>

        {!loading && items.length === 0 && !error && (
          <p style={{ color: 'var(--muted)', textAlign: 'center', marginTop: 40 }}>
            Нет новостей по заданным критериям
          </p>
        )}

        {!loading && showPager && (
          <div
            style={{
              marginTop: 28,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {visiblePages.map((entry, idx) =>
                entry === 'ellipsis' ? (
                  <span key={`e-${idx}`} style={{ color: 'var(--muted)', padding: '0 4px' }}>
                    …
                  </span>
                ) : (
                  <button
                    key={entry}
                    type="button"
                    style={btnStyle(entry === page)}
                    onClick={() => goToPage(entry)}
                    aria-current={entry === page ? 'page' : undefined}
                  >
                    {entry}
                  </button>
                ),
              )}
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>
              Страница {page} из {totalPages} · записей: {total}
            </p>
          </div>
        )}
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

export default function NewsPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '72px 24px', color: 'var(--muted)' }}>
          Загрузка…
        </div>
      }
    >
      <NewsPageInner />
    </Suspense>
  );
}
