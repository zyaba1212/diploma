import { Metadata } from 'next';
import { colors } from '@/theme/colors';

export const metadata: Metadata = {
  title: 'О проекте',
  description:
    'Дипломная работа Зыблиенко Д. Ф. (БГАС): архитектура систем транзакций при частичном отсутствии интернета.',
};

const cardBase: React.CSSProperties = {
  background: colors.bg.card,
  border: `1px solid ${colors.border}`,
  borderRadius: 4,
  padding: 16,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  margin: '0 0 12px',
  fontWeight: 700,
};

export default function AboutPage() {
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
      <div style={{ maxWidth: 880, width: '100%', margin: '0 auto', position: 'relative' }}>
        <header style={{ marginBottom: 36, position: 'relative' }}>
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
              fontSize: 'clamp(1.6rem, 3.5vw, 2.25rem)',
              lineHeight: 1.15,
              margin: 0,
              fontWeight: 600,
              letterSpacing: '-0.03em',
              color: colors.text.primary,
            }}
          >
            О проекте
          </h1>
        </header>

        <div style={{ display: 'grid', gap: 18, gridTemplateColumns: '1fr' }}>
          <section style={cardBase}>
            <div style={labelStyle}>Автор</div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>
              Зыблиенко Дмитрий Фёдорович
            </div>
            <div style={{ fontSize: 15, color: 'var(--muted)', lineHeight: 1.55 }}>
              Белорусская Государственная Академия Связи{' '}
              <span style={{ color: colors.text.secondary }}>(БГАС)</span>
            </div>
          </section>

          <section style={cardBase}>
            <div style={labelStyle}>Тема диплома</div>
            <h2
              style={{
                fontSize: 'clamp(1.05rem, 2vw, 1.2rem)',
                fontWeight: 700,
                lineHeight: 1.45,
                margin: '0 0 14px',
                color: 'var(--text)',
              }}
            >
              &laquo;Архитектура систем транзакций в условиях частичного отсутствия интернета&raquo;
            </h2>
            <p style={{ fontSize: 15, color: 'var(--muted)', lineHeight: 1.7, margin: 0 }}>
              Работа посвящена проектированию и наглядной демонстрации подходов к устойчивым транзакциям при
              деградации или локальном отсутствии каналов связи: альтернативные маршруты, буферизация,
              ретрансляция и резервные каналы — в контексте развития цифровой экономики и требований к
              непрерывности финансовых сервисов.
            </p>
          </section>

          <section style={cardBase}>
            <div style={labelStyle}>Технологический стек</div>
            <ul
              style={{
                margin: 0,
                padding: '0 0 0 18px',
                fontSize: 15,
                lineHeight: 1.85,
                color: colors.text.primary,
              }}
            >
              <li><strong style={{ color: 'var(--text)' }}>Next.js</strong> — маршрутизация и UI</li>
              <li><strong style={{ color: 'var(--text)' }}>Three.js</strong> — интерактивный 3D-глобус</li>
              <li><strong style={{ color: 'var(--text)' }}>Leaflet</strong> — 2D-карта инфраструктуры</li>
              <li><strong style={{ color: 'var(--text)' }}>Solana</strong> — on-chain фиксация и голосование</li>
              <li><strong style={{ color: 'var(--text)' }}>Prisma + PostgreSQL</strong> — данные и миграции</li>
            </ul>
          </section>

          <section style={cardBase}>
            <div style={labelStyle}>Цели проекта</div>
            <ul
              style={{
                margin: 0,
                padding: '0 0 0 18px',
                fontSize: 15,
                lineHeight: 1.85,
                color: colors.text.primary,
              }}
            >
              <li>Визуализация глобальной инфокоммуникационной инфраструктуры в 3D и на карте</li>
              <li>Песочница для экспериментов с архитектурными предложениями по развитию сети</li>
              <li>On-chain управление: голосование по предложениям с привязкой к блокчейну Solana</li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
