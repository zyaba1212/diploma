/* eslint-disable no-console */
/**
 * Seeds a SUBMITTED proposal with CREATE actions for a Belarus offline-transaction network scenario.
 * Run from repo root: node scripts/seed-belarus-proposal.mjs
 * Requires DATABASE_URL (see docs/local-dev-docker.md).
 *
 * Note: Prisma `ChangeAction` has no authorPubkey/signature columns; those are stored inside `elementPayload`.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_AUTHOR = 'SYSTEM_SEED_AUTHOR';
const SEED_SIGNATURE = 'seed-data';

const DESCRIPTION = [
  'Видение устойчивой инфраструктуры офлайн-транзакций для Беларуси: распределённые очереди сообщений,',
  'меш-узлы на ключевых административных объектах и SMS/2G-шлюзы в районных центрах как ретрансляторы при',
  'деградации магистрального интернета. Контекст — уроки урагана в Мозыре (2024) и подготовка к цифровому рублю',
  '(2026): критично иметь локальные офлайн-очереди в банках и отделениях почты, резервные VSAT-терминалы',
  'и подземные магистрали (волокно/медь) между крупными узлами, чтобы платежи и сверка могли доживать',
  'до восстановления связи.',
].join(' ');

function nodePayload(type, name, lat, lng) {
  return {
    type,
    scope: 'LOCAL',
    name,
    lat,
    lng,
    authorPubkey: SEED_AUTHOR,
    signature: SEED_SIGNATURE,
  };
}

function cablePayload(type, name, startLat, startLng, endLat, endLng) {
  return {
    type,
    scope: 'LOCAL',
    name,
    lat: startLat,
    lng: startLng,
    path: [
      { lat: startLat, lng: startLng },
      { lat: endLat, lng: endLng },
    ],
    authorPubkey: SEED_AUTHOR,
    signature: SEED_SIGNATURE,
  };
}

function buildActions() {
  const rows = [];

  const mesh = [
    ['Минск — меш-ретранслятор (адм.)', 53.9045, 27.5615],
    ['Гомель — меш-ретранслятор (адм.)', 52.4345, 30.9754],
    ['Мозырь — меш-ретранслятор (адм.)', 52.0479, 29.2456],
    ['Брест — меш-ретранслятор (адм.)', 52.0976, 23.6877],
    ['Гродно — меш-ретранслятор (адм.)', 53.6779, 23.8293],
    ['Витебск — меш-ретранслятор (адм.)', 55.1904, 30.2049],
    ['Могилёв — меш-ретранслятор (адм.)', 53.8998, 30.3345],
  ];
  for (const [name, lat, lng] of mesh) {
    rows.push({
      actionType: 'CREATE',
      elementPayload: nodePayload('MESH_RELAY', name, lat, lng),
    });
  }

  const sms = [
    ['Бобруйск — SMS-шлюз (2G, райцентр)', 53.1384, 29.2214],
    ['Барановичи — SMS-шлюз (2G, райцентр)', 53.1327, 26.0139],
    ['Пинск — SMS-шлюз (2G, райцентр)', 52.1153, 26.1031],
    ['Полоцк — SMS-шлюз (2G, райцентр)', 55.4879, 28.7856],
    ['Жлобин — SMS-шлюз (2G, райцентр)', 52.8914, 30.0244],
    ['Калинковичи — SMS-шлюз (2G, у Мозыря)', 52.1284, 29.3264],
    ['Речица — SMS-шлюз (2G, райцентр)', 52.3613, 30.3921],
  ];
  for (const [name, lat, lng] of sms) {
    rows.push({
      actionType: 'CREATE',
      elementPayload: nodePayload('SMS_GATEWAY', name, lat, lng),
    });
  }

  const offline = [
    ['Минск — офлайн-очередь (банк/почта)', 53.9, 27.55],
    ['Гомель — офлайн-очередь (банк/почта)', 52.43, 30.98],
    ['Мозырь — офлайн-очередь (банк/почта)', 52.05, 29.25],
    ['Брест — офлайн-очередь (банк/почта)', 52.1, 23.69],
    ['Гродно — офлайн-очередь (банк/почта)', 53.68, 23.83],
  ];
  for (const [name, lat, lng] of offline) {
    rows.push({
      actionType: 'CREATE',
      elementPayload: nodePayload('OFFLINE_QUEUE', name, lat, lng),
    });
  }

  const vsat = [
    ['Минск — VSAT (гос. объект)', 53.91, 27.57],
    ['Мозырь — VSAT (гос. объект)', 52.04, 29.24],
  ];
  for (const [name, lat, lng] of vsat) {
    rows.push({
      actionType: 'CREATE',
      elementPayload: nodePayload('VSAT_TERMINAL', name, lat, lng),
    });
  }

  const minsk = [53.9045, 27.5615];
  const gomel = [52.4345, 30.9754];
  const mozyr = [52.0479, 29.2456];
  const brest = [52.0976, 23.6877];
  const grodno = [53.6779, 23.8293];
  const vitebsk = [55.1904, 30.2049];
  const mogilev = [53.8998, 30.3345];

  const fiberLinks = [
    ['Подземное ВОЛС: Минск — Гомель', ...minsk, ...gomel],
    ['Подземное ВОЛС: Минск — Брест', ...minsk, ...brest],
    ['Подземное ВОЛС: Минск — Гродно', ...minsk, ...grodno],
    ['Подземное ВОЛС: Минск — Витебск', ...minsk, ...vitebsk],
    ['Подземное ВОЛС: Минск — Могилёв', ...minsk, ...mogilev],
    ['Подземное ВОЛС: Гомель — Мозырь', ...gomel, ...mozyr],
  ];
  for (const [name, a, b, c, d] of fiberLinks) {
    rows.push({
      actionType: 'CREATE',
      elementPayload: cablePayload('CABLE_UNDERGROUND_FIBER', name, a, b, c, d),
    });
  }

  const kalinkovichi = [52.1284, 29.3264];
  const zhlobin = [52.8914, 30.0244];
  const rechitsa = [52.3613, 30.3921];
  const pinsk = [52.1153, 26.1031];

  const copperLinks = [
    ['Подземная медь: Мозырь — Калинковичи', ...mozyr, ...kalinkovichi],
    ['Подземная медь: Гомель — Жлобин', ...gomel, ...zhlobin],
    ['Подземная медь: Гомель — Речица', ...gomel, ...rechitsa],
    ['Подземная медь: Брест — Пинск', ...brest, ...pinsk],
  ];
  for (const [name, a, b, c, d] of copperLinks) {
    rows.push({
      actionType: 'CREATE',
      elementPayload: cablePayload('CABLE_UNDERGROUND_COPPER', name, a, b, c, d),
    });
  }

  return rows;
}

const PROPOSAL_TITLE =
  'Устойчивая сеть транзакций Беларуси в условиях отсутствия интернета';

async function main() {
  const votingEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const submittedAt = new Date();

  const existing = await prisma.proposal.findFirst({
    where: { title: PROPOSAL_TITLE },
    select: { id: true },
  });

  if (existing) {
    await prisma.proposal.update({
      where: { id: existing.id },
      data: { pinned: true },
    });
    console.log('Belarus proposal already exists; set pinned=true.', existing.id);
    return;
  }

  const actionTemplates = buildActions();

  const proposal = await prisma.proposal.create({
    data: {
      scope: 'LOCAL',
      authorPubkey: SEED_AUTHOR,
      status: 'SUBMITTED',
      title: PROPOSAL_TITLE,
      description: DESCRIPTION,
      submittedAt,
      votingEndsAt,
      pinned: true,
      actions: {
        createMany: {
          data: actionTemplates.map((a) => ({
            actionType: a.actionType,
            elementPayload: a.elementPayload,
          })),
        },
      },
    },
    select: { id: true, title: true, status: true, submittedAt: true, votingEndsAt: true, pinned: true },
  });

  const actionCount = await prisma.changeAction.count({ where: { proposalId: proposal.id } });

  console.log('Belarus offline-transaction proposal seeded.');
  console.log('Proposal:', proposal);
  console.log(`ChangeAction count: ${actionCount}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
