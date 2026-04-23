'use client';

import Link from 'next/link';
import { useState, type CSSProperties } from 'react';
import { colors } from '@/theme/colors';

const cardPanel: CSSProperties = {
  background: colors.bg.card,
  border: `1px solid ${colors.border}`,
  borderRadius: 4,
  padding: 16,
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
        ...cardPanel,
        textDecoration: 'none',
        color: colors.text.primary,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minHeight: 140,
        background: hover ? colors.bg.tableRowHover : colors.bg.card,
        transition: 'background-color 0.1s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</span>
        <span style={{ fontSize: 12, color: colors.text.secondary, fontWeight: 400 }}>Открыть &rarr;</span>
      </div>
      <div style={{ fontSize: 14, color: colors.text.secondary, lineHeight: 1.55, marginTop: 'auto' }}>
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
        color: colors.text.primary,
        background: colors.bg.primary,
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
        <section style={{ marginBottom: 40, position: 'relative' }}>
          <p
            style={{
              fontSize: 12,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: colors.text.secondary,
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
              fontWeight: 600,
              letterSpacing: '-0.03em',
              maxWidth: 920,
              color: colors.text.primary,
            }}
          >
            <span style={{ color: colors.accent }}>Архитектура систем транзакций</span> в условиях частичного
            отсутствия интернета
          </h1>
          <p
            style={{
              fontSize: 'clamp(1rem, 2vw, 1.2rem)',
              color: colors.text.secondary,
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
          <section style={cardPanel}>
            <h2
              style={{
                fontSize: 13,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: colors.text.secondary,
                margin: '0 0 12px',
                fontWeight: 600,
              }}
            >
              Проблема
            </h2>
            <p style={{ fontSize: 15, lineHeight: 1.65, margin: 0, color: colors.text.primary }}>
              В 2024 году ураган в Мозыре (Беларусь) привёл к{' '}
              <strong style={{ color: colors.text.primary }}>трёхдневной потере связи</strong>. К 2026 году вводится
              цифровой рубль — гражданам нужен{' '}
              <strong style={{ color: colors.text.primary }}>надёжный доступ к транзакциям</strong> даже при отказах
              сети.
            </p>
          </section>
          <section style={cardPanel}>
            <h2
              style={{
                fontSize: 13,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: colors.text.secondary,
                margin: '0 0 12px',
                fontWeight: 600,
              }}
            >
              Решение
            </h2>
            <p style={{ fontSize: 15, lineHeight: 1.65, margin: 0, color: colors.text.primary }}>
              Проект показывает отказоустойчивую архитектуру:{' '}
              <strong style={{ color: colors.text.primary }}>mesh-сети</strong>, ретрансляция через{' '}
              <strong style={{ color: colors.text.primary }}>2G/SMS</strong>,{' '}
              <strong style={{ color: colors.text.primary }}>очереди офлайн-транзакций</strong> и резерв через{' '}
              <strong style={{ color: colors.text.primary }}>VSAT</strong> — чтобы платежи не зависали при обрыве
              интернета.
            </p>
          </section>
        </div>

        <section style={{ marginBottom: 14 }}>
          <h2
            style={{
              fontSize: 13,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: colors.text.secondary,
              margin: '0 0 18px',
              fontWeight: 600,
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
