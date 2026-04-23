'use client';

import Link from 'next/link';
import { Panel } from '@/components/ui/Panel';

/**
 * Справочный блок для авторов LOCAL-предложений: эталонная цепочка и ссылки на редактор / песочницу.
 */
export function LocalScopeNetworkReferencePanel() {
  return (
    <Panel title="Эталонная логика сети для LOCAL (кратко)" style={{ maxWidth: 1040 }}>
      <div id="belarus-network-model" style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text)' }}>
        <p style={{ margin: '0 0 10px' }}>
          Ориентир для описания локальной сети: граница и маршрутизация (в т.ч. BGP) → магистраль → IXP → точка
          присутствия (POP) → доступ абонентов → DNS/CDN. Детали и термины см. в{' '}
          <Link href="/global-network" style={{ color: 'var(--accent, #8ab4f8)' }}>
            глобальной схеме
          </Link>
          .
        </p>
        <ul style={{ margin: '0 0 10px', paddingLeft: 20 }}>
          <li>Внешняя связность и точки обмена трафиком</li>
          <li>Доступ и последняя миля (включая беспроводные сегменты при необходимости)</li>
          <li>Сервисы имени и контента поверх транспорта</li>
        </ul>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--muted)' }}>
          Редактор предложения открывается в отдельном маршруте (не затирает черновик свободной песочницы). Песочница —
          для экспериментов без привязки к предложению.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 13 }}>
          <Link href="/networks" style={{ color: 'var(--accent, #8ab4f8)' }}>
            Список предложений
          </Link>
          <Link href="/sandbox" style={{ color: 'var(--accent, #8ab4f8)' }}>
            Песочница
          </Link>
          <Link href="/" style={{ color: 'var(--accent, #8ab4f8)' }}>
            Главная
          </Link>
        </div>
      </div>
    </Panel>
  );
}
