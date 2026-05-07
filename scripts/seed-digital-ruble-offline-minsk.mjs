/* eslint-disable no-console */
/**
 * Идемпотентный seed для референсного предложения:
 * «Офлайн-платежи цифрового рубля (Минск, mesh + dual-gateway) — референс».
 *
 * Сценарий (обязательная терминология): ключевой материал управляется доверенным
 * контуром платформы цифрового рубля (ЦБ/оператор), подписание происходит в
 * защищённой среде (server-side secure contour / HSM / device-bound credential).
 * В elementPayload секретов не хранится; до синхронизации операция имеет
 * предварительный статус (pending / offline accepted).
 *
 * Запуск из корня репозитория:
 *   node scripts/seed-digital-ruble-offline-minsk.mjs
 *
 * Повторный запуск безопасен: ищет предложение по точному title,
 * пересоздаёт actions в фиксированном порядке, обновляет description,
 * выставляет pinned=true, не трогает других авторов/предложения.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_AUTHOR = 'SYSTEM_SEED_AUTHOR';
const SEED_SIGNATURE = 'seed-digital-ruble-minsk';

const TITLE = 'Офлайн-платежи цифрового рубля (Минск, mesh + dual-gateway) — референс';

const DESCRIPTION = [
  'Референсный сценарий офлайн-платежей цифрового рубля в городе Минск (Беларусь).',
  'Топология построена в виде наглядной сети (mesh-ячейки, dual-gateway, edge/core, VSAT-антенны и резервный спутниковый аплинк),',
  'а не линейной цепочки: это позволяет визуально читать маршруты доставки, резервирования и возврата подтверждений.',
  '',
  'Модель безопасности: ключевой материал управляется доверенным контуром платформы (ЦБ/оператор);',
  'подписание операций происходит в защищённой среде (server-side secure contour / HSM / device-bound credential).',
  'В полезной нагрузке узлов и связей секретов не хранится; до синхронизации с центральным реестром',
  'операция имеет предварительный статус (pending / offline accepted).',
  '',
  'Шаги сценария:',
  'Step 1. QR-инвойс: магазин формирует запрос оплаты (сумма, merchant id, nonce).',
  'Step 2. Подтверждение в приложении: клиент подтверждает оплату; запрос визируется в защищённом контуре устройства/платформы.',
  'Step 3. Постановка в офлайн-очередь: операция помечается pending / offline accepted на устройстве клиента и точке продаж.',
  'Step 4. Передача по mesh: сообщение маршрутизируется через mesh-ячейки и сходится к POS и gateway-узлам по нескольким веткам.',
  'Step 5. Приём и дедупликация на gateway: gateway (primary/backup) валидирует формат, удаляет дубликаты, буферизует пакет.',
  'Step 6. Доставка на edge node: edge-узел агрегирует очередь и готовит батч к передаче в ядро.',
  'Step 7. Отправка в центральную платформу цифрового рубля: edge-узел синхронизирует батч с Core по защищённому каналу.',
  'Step 7b. Спутниковый резерв: при деградации наземного uplink используется спутниковый канал — VSAT-антенны на кровлях edge-узлов передают трафик через орбитальный спутник к Core.',
  'Step 8. Финализация и обновление балансов: Core обновляет центральный реестр; операция переходит из pending в финальный статус.',
  'Step 9. Возврат подтверждения: подтверждение возвращается Core → Edge Node A → Gateway-Primary → Merchant POS → Client A.',
].join('\n');

const NODES = [
  {
    tempId: 'client-a',
    type: 'MODEM',
    role: 'payer',
    step: 2,
    stepLabel: 'Step 2 подтверждение в приложении',
    name: 'Client A (Плательщик)',
    lat: 53.9027,
    lng: 27.5619,
    description: 'Устройство клиента с офлайн-кошельком цифрового рубля; подписание в защищённом контуре устройства/платформы.',
  },
  {
    tempId: 'merchant-pos',
    type: 'OFFLINE_QUEUE',
    role: 'merchant',
    step: 1,
    stepLabel: 'Step 1 QR-инвойс',
    name: 'Merchant POS (Магазин / QR)',
    lat: 53.9052,
    lng: 27.5668,
    description: 'Точка продаж: формирует QR-инвойс, ведёт локальную offline accepted очередь до синхронизации.',
  },
  { tempId: 'mesh-1', type: 'MESH_RELAY', role: 'mesh', step: 4, stepLabel: 'Step 4 передача по mesh', name: 'Mesh-1 (West)', lat: 53.9034, lng: 27.5608 },
  { tempId: 'mesh-2', type: 'MESH_RELAY', role: 'mesh', step: 4, stepLabel: 'Step 4 передача по mesh', name: 'Mesh-2 (South-West)', lat: 53.9029, lng: 27.5632 },
  { tempId: 'mesh-3', type: 'MESH_RELAY', role: 'mesh', step: 4, stepLabel: 'Step 4 передача по mesh', name: 'Mesh-3 (Center)', lat: 53.9041, lng: 27.5639 },
  { tempId: 'mesh-4', type: 'MESH_RELAY', role: 'mesh', step: 4, stepLabel: 'Step 4 передача по mesh', name: 'Mesh-4 (North)', lat: 53.9056, lng: 27.5638 },
  { tempId: 'mesh-5', type: 'MESH_RELAY', role: 'mesh', step: 4, stepLabel: 'Step 4 передача по mesh', name: 'Mesh-5 (East)', lat: 53.9053, lng: 27.5659 },
  { tempId: 'mesh-6', type: 'MESH_RELAY', role: 'mesh', step: 4, stepLabel: 'Step 4 передача по mesh', name: 'Mesh-6 (North-East)', lat: 53.9064, lng: 27.5672 },
  { tempId: 'mesh-7', type: 'MESH_RELAY', role: 'mesh', step: 4, stepLabel: 'Step 4 передача по mesh', name: 'Mesh-7 (POS-near)', lat: 53.9054, lng: 27.5668 },
  {
    tempId: 'gateway-primary',
    type: 'SWITCH',
    role: 'gateway-primary',
    step: 5,
    stepLabel: 'Step 5 приём и дедупликация на gateway',
    name: 'Gateway-Primary',
    lat: 53.907,
    lng: 27.5685,
    description: 'Основной шлюз: дедупликация и буферизация пакетов перед передачей на edge-узел.',
  },
  {
    tempId: 'gateway-backup',
    type: 'SWITCH',
    role: 'gateway-backup',
    step: 5,
    stepLabel: 'Step 5 приём и дедупликация на gateway',
    name: 'Gateway-Backup',
    lat: 53.9072,
    lng: 27.5627,
    description: 'Резервный шлюз: включается при деградации primary-канала.',
  },
  {
    tempId: 'edge-a',
    type: 'SERVER',
    role: 'edge-primary',
    step: 6,
    stepLabel: 'Step 6 доставка на edge node',
    name: 'Edge Node A',
    lat: 53.9094,
    lng: 27.5719,
    description: 'Edge-узел primary uplink: агрегация батчей и защищённая синхронизация с центральной платформой.',
  },
  {
    tempId: 'edge-b',
    type: 'SERVER',
    role: 'edge-backup',
    step: 6,
    stepLabel: 'Step 6 доставка на edge node',
    name: 'Edge Node B',
    lat: 53.9088,
    lng: 27.5605,
    description: 'Edge-узел backup uplink: резервный маршрут агрегации и синхронизации.',
  },
  {
    tempId: 'core',
    type: 'SERVER',
    role: 'core',
    step: 7,
    stepRange: [7, 8],
    stepLabel: 'Step 7-8 центральная платформа: отправка, финализация, обновление балансов',
    name: 'Центральная платформа цифрового рубля (Core)',
    lat: 53.9112,
    lng: 27.5764,
    description: 'Центральный реестр цифрового рубля: финализация, обновление балансов, доверенный контур ключевого материала (HSM).',
  },
  {
    tempId: 'vsat-a',
    type: 'VSAT_TERMINAL',
    role: 'vsat-primary',
    step: 7,
    stepRange: [7, 8],
    stepLabel: 'Step 7b спутниковый резерв: VSAT uplink',
    name: 'VSAT Antenna A (крыша Edge Node A)',
    lat: 53.9096,
    lng: 27.5722,
    description: 'Наземная VSAT-антенна на кровле Edge Node A: резервный спутниковый uplink при деградации наземного канала.',
  },
  {
    tempId: 'vsat-b',
    type: 'VSAT_TERMINAL',
    role: 'vsat-backup',
    step: 7,
    stepRange: [7, 8],
    stepLabel: 'Step 7b спутниковый резерв: VSAT uplink',
    name: 'VSAT Antenna B (крыша Edge Node B)',
    lat: 53.9086,
    lng: 27.5608,
    description: 'Наземная VSAT-антенна на кровле Edge Node B: альтернативный спутниковый uplink.',
  },
  {
    tempId: 'satellite',
    type: 'SATELLITE',
    role: 'satellite-backhaul',
    step: 7,
    stepRange: [7, 8],
    stepLabel: 'Step 7b спутниковый резерв: backhaul через спутник',
    name: 'Спутник (backhaul)',
    lat: 53.92,
    lng: 27.6,
    altitude: 550,
    description: 'Орбитальный спутник backhaul-канала: резервная передача трафика от VSAT-антенн к центральной платформе.',
  },
];

const NODE_BY_ID = Object.fromEntries(NODES.map((n) => [n.tempId, n]));

/**
 * Линии топологии. kind ∈ { mesh, primary, backup, return }.
 * Типы линий подобраны так, чтобы primary и backup визуально различались.
 */
const LINKS = [
  // A) Mesh fabric (не линейная цепочка, а ветвящаяся сеть)
  {
    from: 'client-a',
    to: 'mesh-1',
    kind: 'mesh',
    step: 4,
    type: 'CABLE_FIBER',
    name: 'Mesh: Client A → Mesh-1',
    stepLabel: 'Шаг 4: ввод в mesh (ветка west)',
  },
  {
    from: 'client-a',
    to: 'mesh-2',
    kind: 'mesh',
    step: 4,
    type: 'CABLE_FIBER',
    name: 'Mesh: Client A → Mesh-2',
    stepLabel: 'Шаг 4: ввод в mesh (ветка south-west)',
  },
  {
    from: 'mesh-1',
    to: 'mesh-3',
    kind: 'mesh',
    step: 4,
    type: 'CABLE_FIBER',
    name: 'Mesh: Mesh-1 → Mesh-3',
    stepLabel: 'Шаг 4: east-bound сегмент',
  },
  {
    from: 'mesh-2',
    to: 'mesh-3',
    kind: 'mesh',
    step: 4,
    type: 'CABLE_FIBER',
    name: 'Mesh: Mesh-2 → Mesh-3',
    stepLabel: 'Шаг 4: сегмент mesh-цепи',
  },
  {
    from: 'mesh-3',
    to: 'mesh-4',
    kind: 'mesh',
    step: 4,
    type: 'CABLE_FIBER',
    name: 'Mesh: Mesh-3 → Mesh-4',
    stepLabel: 'Шаг 4: сегмент mesh-цепи',
  },
  {
    from: 'mesh-3',
    to: 'mesh-5',
    kind: 'mesh',
    step: 4,
    type: 'CABLE_FIBER',
    name: 'Mesh: Mesh-3 → Mesh-5',
    stepLabel: 'Шаг 4: east сегмент',
  },
  {
    from: 'mesh-4',
    to: 'mesh-6',
    kind: 'mesh',
    step: 4,
    type: 'CABLE_FIBER',
    name: 'Mesh: Mesh-4 → Mesh-6',
    stepLabel: 'Шаг 4: north-east сегмент',
  },
  {
    from: 'mesh-5',
    to: 'mesh-6',
    kind: 'mesh',
    step: 4,
    type: 'CABLE_FIBER',
    name: 'Mesh: Mesh-5 → Mesh-6',
    stepLabel: 'Шаг 4: east-to-north-east сегмент',
  },
  {
    from: 'mesh-6',
    to: 'mesh-7',
    kind: 'mesh',
    step: 4,
    type: 'CABLE_FIBER',
    name: 'Mesh: Mesh-6 → Mesh-7',
    stepLabel: 'Шаг 4: сход к POS-домену',
  },
  {
    from: 'mesh-7',
    to: 'merchant-pos',
    kind: 'mesh',
    step: 4,
    type: 'CABLE_FIBER',
    name: 'Mesh: Mesh-7 → Merchant POS',
    stepLabel: 'Шаг 4: доставка на точку продажи (POS)',
  },
  {
    from: 'mesh-5',
    to: 'merchant-pos',
    kind: 'mesh',
    step: 4,
    type: 'CABLE_FIBER',
    name: 'Mesh: Mesh-5 → Merchant POS',
    stepLabel: 'Шаг 4: альтернативный сегмент к POS',
  },

  // B) Primary uplink
  {
    from: 'mesh-7',
    to: 'gateway-primary',
    kind: 'primary',
    step: 5,
    stepRange: [5, 7],
    type: 'CABLE_UNDERGROUND_FIBER',
    name: 'Primary uplink: Mesh-7 → Gateway-Primary',
    stepLabel: 'Шаг 5-7: основной uplink — сегмент mesh → основной шлюз',
  },
  {
    from: 'gateway-primary',
    to: 'edge-a',
    kind: 'primary',
    step: 6,
    stepRange: [5, 7],
    type: 'CABLE_UNDERGROUND_FIBER',
    name: 'Primary uplink: Gateway-Primary → Edge Node A',
    stepLabel: 'Шаг 5-7: основной uplink — шлюз → edge-узел A',
  },
  {
    from: 'edge-a',
    to: 'core',
    kind: 'primary',
    step: 7,
    stepRange: [5, 7],
    type: 'CABLE_UNDERGROUND_FIBER',
    name: 'Primary uplink: Edge Node A → Core',
    stepLabel: 'Шаг 5-7: основной uplink — edge-узел A → центральная платформа (Core)',
  },

  // C) Backup uplink
  {
    from: 'mesh-4',
    to: 'gateway-backup',
    kind: 'backup',
    step: 5,
    stepRange: [5, 7],
    type: 'CABLE_UNDERGROUND_COPPER',
    name: 'Backup uplink: Mesh-4 → Gateway-Backup',
    stepLabel: 'Шаг 5-7: резервный uplink — сегмент mesh → резервный шлюз',
  },
  {
    from: 'gateway-backup',
    to: 'edge-b',
    kind: 'backup',
    step: 6,
    stepRange: [5, 7],
    type: 'CABLE_UNDERGROUND_COPPER',
    name: 'Backup uplink: Gateway-Backup → Edge Node B',
    stepLabel: 'Шаг 5-7: резервный uplink — шлюз → edge-узел B',
  },
  {
    from: 'edge-b',
    to: 'core',
    kind: 'backup',
    step: 7,
    stepRange: [5, 7],
    type: 'CABLE_UNDERGROUND_COPPER',
    name: 'Backup uplink: Edge Node B → Core',
    stepLabel: 'Шаг 5-7: резервный uplink — edge-узел B → центральная платформа (Core)',
  },

  // D) Satellite reserve (VSAT + orbital satellite backhaul)
  {
    from: 'edge-a',
    to: 'vsat-a',
    kind: 'satellite',
    step: 7,
    stepRange: [7, 8],
    type: 'CABLE_FIBER',
    name: 'Satellite feed: Edge Node A → VSAT A (rooftop)',
    stepLabel: 'Шаг 7b: подача трафика на VSAT-антенну (крыша Edge A)',
  },
  {
    from: 'edge-b',
    to: 'vsat-b',
    kind: 'satellite',
    step: 7,
    stepRange: [7, 8],
    type: 'CABLE_FIBER',
    name: 'Satellite feed: Edge Node B → VSAT B (rooftop)',
    stepLabel: 'Шаг 7b: подача трафика на VSAT-антенну (крыша Edge B)',
  },
  {
    from: 'vsat-a',
    to: 'satellite',
    kind: 'satellite',
    step: 7,
    stepRange: [7, 8],
    type: 'CABLE_FIBER',
    name: 'Satellite uplink: VSAT A → Satellite',
    stepLabel: 'Шаг 7b: резервный аплинк — VSAT A → орбитальный спутник',
    via: [{ lat: 53.914, lng: 27.586 }],
  },
  {
    from: 'vsat-b',
    to: 'satellite',
    kind: 'satellite',
    step: 7,
    stepRange: [7, 8],
    type: 'CABLE_FIBER',
    name: 'Satellite uplink: VSAT B → Satellite',
    stepLabel: 'Шаг 7b: резервный аплинк — VSAT B → орбитальный спутник',
    via: [{ lat: 53.913, lng: 27.552 }],
  },
  {
    from: 'satellite',
    to: 'core',
    kind: 'satellite',
    step: 7,
    stepRange: [7, 8],
    type: 'CABLE_FIBER',
    name: 'Satellite downlink: Satellite → Core',
    stepLabel: 'Шаг 7b: downlink — орбитальный спутник → Core',
    via: [{ lat: 53.916, lng: 27.589 }],
  },

  // E) Return / confirmation path
  {
    from: 'core',
    to: 'edge-a',
    kind: 'return',
    step: 9,
    type: 'CABLE_COPPER',
    name: 'Return: Core → Edge Node A',
    stepLabel: 'Шаг 9: путь подтверждения/возврата — Core → edge A',
  },
  {
    from: 'edge-a',
    to: 'gateway-primary',
    kind: 'return',
    step: 9,
    type: 'CABLE_COPPER',
    name: 'Return: Edge Node A → Gateway-Primary',
    stepLabel: 'Шаг 9: путь подтверждения — edge A → основной шлюз',
  },
  {
    from: 'gateway-primary',
    to: 'merchant-pos',
    kind: 'return',
    step: 9,
    type: 'CABLE_COPPER',
    name: 'Return: Gateway-Primary → Merchant POS',
    stepLabel: 'Шаг 9: путь подтверждения — шлюз → магазин (POS)',
  },
  {
    from: 'merchant-pos',
    to: 'client-a',
    kind: 'return',
    step: 9,
    type: 'CABLE_COPPER',
    name: 'Return: Merchant POS → Client A',
    stepLabel: 'Шаг 9: финал подтверждения — POS → клиент',
  },
];

/**
 * Линия хранится как набор точек [from, ...via, to];
 * визуальные различия направлений (mesh/primary/backup/satellite/return)
 * выполняются на уровне рендера.
 */
function buildPath(fromNode, toNode, via = []) {
  return [
    { lat: fromNode.lat, lng: fromNode.lng },
    ...via,
    { lat: toNode.lat, lng: toNode.lng },
  ];
}

function nodePayload(node) {
  return {
    tempId: node.tempId,
    type: node.type,
    scope: 'LOCAL',
    name: node.name,
    lat: node.lat,
    lng: node.lng,
    authorPubkey: SEED_AUTHOR,
    signature: SEED_SIGNATURE,
    metadata: {
      scenario: 'digital-ruble-offline-minsk',
      role: node.role,
      step: node.step ?? null,
      stepRange: node.stepRange ?? null,
      stepLabel: node.stepLabel ?? null,
      description: node.description ?? null,
      securityModel: {
        keyCustody: 'platform-trusted-contour',
        signingEnvironment: 'server-side-secure-contour / HSM / device-bound credential',
        note: 'Секреты в этой полезной нагрузке не хранятся.',
      },
      preSyncStatus: 'pending / offline accepted',
    },
  };
}

function linkPayload(link, fromNode, toNode) {
  const path = buildPath(fromNode, toNode, Array.isArray(link.via) ? link.via : []);
  return {
    tempId: `${link.from}->${link.to}:${link.kind}`,
    type: link.type,
    scope: 'LOCAL',
    name: link.name,
    lat: fromNode.lat,
    lng: fromNode.lng,
    path,
    authorPubkey: SEED_AUTHOR,
    signature: SEED_SIGNATURE,
    metadata: {
      scenario: 'digital-ruble-offline-minsk',
      linkKind: link.kind,
      isPrimary: link.kind === 'primary',
      isBackup: link.kind === 'backup',
      isReturn: link.kind === 'return',
      isSatellite: link.kind === 'satellite',
      step: link.step ?? null,
      stepRange: link.stepRange ?? null,
      stepLabel: link.stepLabel ?? null,
      fromTempId: link.from,
      toTempId: link.to,
      fromName: fromNode.name,
      toName: toNode.name,
    },
  };
}

function buildActions() {
  const rows = [];

  for (const node of NODES) {
    rows.push({ actionType: 'CREATE', elementPayload: nodePayload(node) });
  }

  for (const link of LINKS) {
    const from = NODE_BY_ID[link.from];
    const to = NODE_BY_ID[link.to];
    if (!from || !to) {
      throw new Error(`Link references unknown node: ${link.from} -> ${link.to}`);
    }
    rows.push({ actionType: 'CREATE', elementPayload: linkPayload(link, from, to) });
  }

  return rows;
}

async function main() {
  const actionTemplates = buildActions();

  const existing = await prisma.proposal.findFirst({
    where: { title: TITLE },
    select: { id: true, authorPubkey: true, status: true },
  });

  let proposalId;
  let wasCreated = false;

  if (existing) {
    if (existing.authorPubkey !== SEED_AUTHOR) {
      throw new Error(
        `Proposal with title already exists but owned by ${existing.authorPubkey} (expected ${SEED_AUTHOR}); refusing to modify foreign data.`,
      );
    }

    proposalId = existing.id;

    await prisma.$transaction(async (tx) => {
      await tx.changeAction.deleteMany({ where: { proposalId } });
      await tx.proposal.update({
        where: { id: proposalId },
        data: {
          scope: 'LOCAL',
          status: existing.status === 'APPLIED' || existing.status === 'ACCEPTED' ? existing.status : 'SUBMITTED',
          description: DESCRIPTION,
          pinned: true,
          submittedAt: new Date(),
          votingEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      await tx.changeAction.createMany({
        data: actionTemplates.map((a) => ({
          proposalId,
          actionType: a.actionType,
          elementPayload: a.elementPayload,
        })),
      });
    });
  } else {
    const created = await prisma.proposal.create({
      data: {
        scope: 'LOCAL',
        authorPubkey: SEED_AUTHOR,
        status: 'SUBMITTED',
        title: TITLE,
        description: DESCRIPTION,
        pinned: true,
        submittedAt: new Date(),
        votingEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        actions: {
          createMany: {
            data: actionTemplates.map((a) => ({
              actionType: a.actionType,
              elementPayload: a.elementPayload,
            })),
          },
        },
      },
      select: { id: true },
    });
    proposalId = created.id;
    wasCreated = true;
  }

  const [actionCount, proposal] = await Promise.all([
    prisma.changeAction.count({ where: { proposalId } }),
    prisma.proposal.findUnique({
      where: { id: proposalId },
      select: { id: true, title: true, status: true, pinned: true, scope: true, submittedAt: true, votingEndsAt: true },
    }),
  ]);

  const nodeCount = NODES.length;
  const linkCount = LINKS.length;

  console.log('==== Digital Ruble offline (Minsk) reference proposal ====');
  console.log(wasCreated ? 'Created new proposal.' : 'Updated existing proposal (idempotent rebuild).');
  console.log('Proposal:', proposal);
  console.log(`Actions total: ${actionCount} (nodes: ${nodeCount}, links: ${linkCount})`);
  console.log('');
  console.log('Nodes:');
  for (const n of NODES) {
    console.log(`  - [${n.type.padEnd(14)}] ${n.name.padEnd(48)} lat=${n.lat} lng=${n.lng}`);
  }
  console.log('');
  console.log('Links:');
  for (const l of LINKS) {
    console.log(`  - [${l.kind.padEnd(7)}] ${l.name}`);
  }
  console.log('');
  console.log(`Pinned: ${proposal?.pinned === true}`);
  console.log('Re-run command: node scripts/seed-digital-ruble-offline-minsk.mjs');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
