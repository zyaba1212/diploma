'use client';

import Link from 'next/link';
import { useEffect, useState, type CSSProperties } from 'react';

const gradientText: CSSProperties = {
  background: 'linear-gradient(120deg, #a78bfa 0%, #7aa2ff 45%, #38bdf8 100%)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
};

const glassPanel: CSSProperties = {
  background: 'linear-gradient(145deg, rgba(122, 162, 255, 0.08), rgba(168, 85, 247, 0.06))',
  border: '1px solid var(--border)',
  borderRadius: 18,
  padding: '22px 24px',
  backdropFilter: 'blur(14px)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
};

const featureCards = [
  {
    href: '/global-network',
    title: 'Глобальная сеть',
    description:
      'Интерактивный 3D-глобус и 2D-карта: визуализация мировой инфраструктуры связи.',
  },
  {
    href: '/sandbox',
    title: 'Песочница',
    description: 'Соберите и протестируйте собственные архитектурные предложения для сети.',
  },
  {
    href: '/networks',
    title: 'Предложения',
    description: 'On-chain голосование за изменения сети через блокчейн Solana.',
  },
  {
    href: '/news',
    title: 'Новости',
    description: 'Лента новостей о технологиях и телекоммуникациях.',
  },
] as const;

/** Ссылка на закреплённое предложение с топологией по РБ (первый в списке API после сида). */
function BelarusReferenceLink() {
  const [href, setHref] = useState('/networks');
  useEffect(() => {
    let cancelled = false;
    fetch('/api/proposals?status=SUBMITTED,ACCEPTED,APPLIED&limit=1')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id?: string }[]) => {
        if (!cancelled && list?.[0]?.id) setHref(`/networks/${list[0].id}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <Link
      href={href}
      style={{
        display: 'inline-block',
        marginTop: 14,
        fontSize: 14,
        fontWeight: 600,
        color: '#8ab4f8',
        textDecoration: 'none',
        borderBottom: '1px solid rgba(120, 160, 255, 0.35)',
      }}
    >
      Референсная сеть по Беларуси в разделе «Предложения» →
    </Link>
  );
}

function FeatureCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...glassPanel,
        textDecoration: 'none',
        color: 'var(--text)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minHeight: 140,
        transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
        transform: hover ? 'translateY(-3px)' : 'none',
        boxShadow: hover
          ? '0 14px 40px rgba(122, 162, 255, 0.15), 0 8px 32px rgba(0, 0, 0, 0.3)'
          : '0 8px 32px rgba(0, 0, 0, 0.25)',
        borderColor: hover ? 'rgba(167, 139, 250, 0.35)' : 'var(--border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>Открыть &rarr;</span>
      </div>
      <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.55, marginTop: 'auto' }}>
        {description}
      </div>
    </Link>
  );
}

export function HomePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        paddingTop: 70,
        paddingLeft: 24,
        paddingRight: 24,
        paddingBottom: 48,
        color: 'var(--text)',
      }}
    >
      <div
        style={{
          maxWidth: 1040,
          width: '100%',
          margin: '0 auto',
          position: 'relative',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: -40,
            right: -20,
            width: 320,
            height: 320,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(122, 162, 255, 0.22) 0%, rgba(168, 85, 247, 0.1) 45%, transparent 70%)',
            filter: 'blur(2px)',
            pointerEvents: 'none',
          }}
        />

        <section style={{ marginBottom: 40, position: 'relative' }}>
          <p
            style={{
              fontSize: 12,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              margin: '0 0 14px',
              fontWeight: 600,
            }}
          >
            Дипломный проект
          </p>
          <h1
            style={{
              fontSize: 'clamp(1.75rem, 4vw, 2.65rem)',
              lineHeight: 1.12,
              margin: '0 0 16px',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              maxWidth: 920,
            }}
          >
            <span style={gradientText}>
              Архитектура систем транзакций в условиях частичного отсутствия сетевого соединения
            </span>
          </h1>
          <p
            style={{
              fontSize: 'clamp(1rem, 2vw, 1.2rem)',
              color: 'var(--muted)',
              lineHeight: 1.65,
              margin: 0,
              maxWidth: 720,
            }}
          >
            Исследование и демонстрация устойчивой сетевой архитектуры для финансовых операций при сбоях
            инфраструктуры — от mesh-сетей до спутниковых каналов.
          </p>
        </section>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 18,
            marginBottom: 36,
          }}
        >
          <section style={glassPanel}>
            <h2
              style={{
                fontSize: 13,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--muted)',
                margin: '0 0 12px',
                fontWeight: 700,
              }}
            >
              Проблема
            </h2>
            <p style={{ fontSize: 15, lineHeight: 1.65, margin: 0, color: 'rgba(232, 236, 255, 0.92)' }}>
              В 2024 году ураган в Мозыре (Беларусь) привёл к{' '}
              <strong style={{ color: 'var(--text)' }}>трёхдневной потере связи</strong>. К 2026 году вводится
              цифровой рубль — гражданам нужен{' '}
              <strong style={{ color: 'var(--text)' }}>надёжный доступ к транзакциям</strong> даже при отказах
              сети.
            </p>
          </section>
          <section style={glassPanel}>
            <h2
              style={{
                fontSize: 13,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--muted)',
                margin: '0 0 12px',
                fontWeight: 700,
              }}
            >
              Решение
            </h2>
            <p style={{ fontSize: 15, lineHeight: 1.65, margin: 0, color: 'rgba(232, 236, 255, 0.92)' }}>
              На платформе разложена в данных{' '}
              <strong style={{ color: 'var(--text)' }}>референсная топология в границах Республики Беларусь</strong>:
              узлы <strong style={{ color: 'var(--text)' }}>mesh</strong>, шлюзы{' '}
              <strong style={{ color: 'var(--text)' }}>2G/SMS</strong>,{' '}
              <strong style={{ color: 'var(--text)' }}>офлайн-очереди</strong> и{' '}
              <strong style={{ color: 'var(--text)' }}>VSAT</strong>, подкреплённые подземными магистралями между
              областными центрами — чтобы платежи не зависали при деградации интернета. Предложение закреплено вверху
              списка «Предложенные сети».
            </p>
            <BelarusReferenceLink />
          </section>
        </div>

        <section style={{ marginBottom: 14 }}>
          <h2
            style={{
              fontSize: 13,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              margin: '0 0 18px',
              fontWeight: 700,
            }}
          >
            Возможности платформы
          </h2>
          <div
            className="home-feature-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 16,
            }}
          >
            {featureCards.map((c) => (
              <FeatureCard key={c.href} {...c} />
            ))}
          </div>
        </section>
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `@media (max-width: 700px) { .home-feature-grid { grid-template-columns: 1fr !important; } }`,
        }}
      />
    </main>
  );
}
