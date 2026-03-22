/**
 * Generate representative global terrestrial backbone cable routes.
 *
 * These are realistic but simplified routes following known internet
 * backbone corridors worldwide. Suitable for diploma project visualization.
 *
 * Idempotency: uses sourceId prefix "global-backbone-" with upsert.
 *
 * Usage:
 *   node scripts/sync-global-backbone-cables.mjs
 *   node scripts/sync-global-backbone-cables.mjs --dry-run
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const SCOPE = 'GLOBAL';

const BACKBONE_ROUTES = [
  // ── North America ──
  {
    name: 'US East Coast Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Level3 Communications',
    countries: ['США'],
    year: 1996,
    description: 'Основная магистраль восточного побережья США',
    path: [
      { lat: 42.36, lng: -71.06 },  // Boston
      { lat: 41.88, lng: -87.63 },  // Chicago (via inland)
      { lat: 40.71, lng: -74.01 },  // New York
      { lat: 39.95, lng: -75.17 },  // Philadelphia
      { lat: 38.91, lng: -77.04 },  // Washington DC
      { lat: 36.85, lng: -75.98 },  // Virginia Beach
    ],
  },
  {
    name: 'US Transcontinental North',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Level3 Communications',
    countries: ['США'],
    year: 1998,
    description: 'Трансконтинентальная магистраль север США',
    path: [
      { lat: 40.71, lng: -74.01 },  // New York
      { lat: 40.44, lng: -79.99 },  // Pittsburgh
      { lat: 41.88, lng: -87.63 },  // Chicago
      { lat: 41.26, lng: -95.94 },  // Omaha
      { lat: 40.76, lng: -111.89 }, // Salt Lake City
      { lat: 37.77, lng: -122.42 }, // San Francisco
    ],
  },
  {
    name: 'US Transcontinental South',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'AT&T Backbone',
    countries: ['США'],
    year: 2001,
    description: 'Трансконтинентальная магистраль юг США',
    path: [
      { lat: 33.75, lng: -84.39 },  // Atlanta
      { lat: 32.78, lng: -96.80 },  // Dallas
      { lat: 33.45, lng: -112.07 }, // Phoenix
      { lat: 34.05, lng: -118.24 }, // Los Angeles
    ],
  },
  {
    name: 'US Southeast Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'AT&T Backbone',
    countries: ['США'],
    year: 1999,
    description: 'Магистраль юго-востока США',
    path: [
      { lat: 38.91, lng: -77.04 },  // Washington DC
      { lat: 35.78, lng: -78.64 },  // Raleigh
      { lat: 33.75, lng: -84.39 },  // Atlanta
      { lat: 30.33, lng: -81.66 },  // Jacksonville
      { lat: 25.76, lng: -80.19 },  // Miami
    ],
  },
  {
    name: 'US West Coast Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Zayo Group',
    countries: ['США'],
    year: 1997,
    description: 'Магистраль западного побережья США',
    path: [
      { lat: 47.61, lng: -122.33 }, // Seattle
      { lat: 45.52, lng: -122.68 }, // Portland
      { lat: 37.77, lng: -122.42 }, // San Francisco
      { lat: 34.05, lng: -118.24 }, // Los Angeles
      { lat: 32.72, lng: -117.16 }, // San Diego
    ],
  },
  {
    name: 'Canada Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Bell Canada',
    countries: ['Канада'],
    year: 2003,
    description: 'Канадская трансконтинентальная магистраль',
    path: [
      { lat: 49.28, lng: -123.12 }, // Vancouver
      { lat: 51.05, lng: -114.07 }, // Calgary
      { lat: 52.27, lng: -113.81 }, // Red Deer
      { lat: 50.45, lng: -104.62 }, // Regina
      { lat: 49.90, lng: -97.14 },  // Winnipeg
      { lat: 43.65, lng: -79.38 },  // Toronto
      { lat: 45.50, lng: -73.57 },  // Montreal
    ],
  },
  // ── Europe ──
  {
    name: 'Western Europe Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'euNetworks',
    countries: ['Великобритания', 'Франция', 'Люксембург', 'Германия'],
    year: 1995,
    description: 'Западноевропейская магистраль Лондон-Франкфурт',
    path: [
      { lat: 51.51, lng: -0.13 },   // London
      { lat: 51.44, lng: 0.37 },    // Channel crossing
      { lat: 50.85, lng: 1.76 },    // Calais
      { lat: 48.86, lng: 2.35 },    // Paris
      { lat: 49.61, lng: 6.13 },    // Luxembourg
      { lat: 50.11, lng: 8.68 },    // Frankfurt
    ],
  },
  {
    name: 'Nordic-Central Europe',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Telia Carrier',
    countries: ['Швеция', 'Дания', 'Германия', 'Швейцария', 'Италия'],
    year: 2000,
    description: 'Северо-центральноевропейская магистраль',
    path: [
      { lat: 59.33, lng: 18.07 },   // Stockholm
      { lat: 55.68, lng: 12.57 },   // Copenhagen
      { lat: 53.55, lng: 9.99 },    // Hamburg
      { lat: 50.11, lng: 8.68 },    // Frankfurt
      { lat: 48.14, lng: 11.58 },   // Munich
      { lat: 47.37, lng: 8.54 },    // Zurich
      { lat: 45.46, lng: 9.19 },    // Milan
    ],
  },
  {
    name: 'Mediterranean Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Telefonica',
    countries: ['Португалия', 'Испания', 'Франция', 'Италия', 'Греция'],
    year: 2002,
    description: 'Средиземноморская магистраль',
    path: [
      { lat: 38.72, lng: -9.14 },   // Lisbon
      { lat: 40.42, lng: -3.70 },   // Madrid
      { lat: 41.39, lng: 2.17 },    // Barcelona
      { lat: 43.30, lng: 5.37 },    // Marseille
      { lat: 45.46, lng: 9.19 },    // Milan
      { lat: 41.90, lng: 12.50 },   // Rome
      { lat: 37.97, lng: 23.73 },   // Athens
    ],
  },
  {
    name: 'Central-East Europe',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Deutsche Telekom',
    countries: ['Германия', 'Польша', 'Украина'],
    year: 2005,
    description: 'Центрально-восточноевропейская магистраль',
    path: [
      { lat: 50.11, lng: 8.68 },    // Frankfurt
      { lat: 52.52, lng: 13.41 },   // Berlin
      { lat: 52.23, lng: 21.01 },   // Warsaw
      { lat: 50.45, lng: 30.52 },   // Kyiv
    ],
  },
  {
    name: 'Benelux-Amsterdam Hub',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'AMS-IX Network',
    countries: ['Великобритания', 'Нидерланды', 'Бельгия', 'Франция'],
    year: 1998,
    description: 'Магистраль Бенилюкс через Амстердамский хаб',
    path: [
      { lat: 51.51, lng: -0.13 },   // London
      { lat: 52.37, lng: 4.90 },    // Amsterdam
      { lat: 50.85, lng: 4.35 },    // Brussels
      { lat: 48.86, lng: 2.35 },    // Paris
    ],
  },
  // ── Asia ──
  {
    name: 'East Asia Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'China Telecom',
    countries: ['Китай'],
    year: 2004,
    description: 'Магистраль восточного Китая',
    path: [
      { lat: 39.91, lng: 116.40 },  // Beijing
      { lat: 36.07, lng: 120.38 },  // Qingdao
      { lat: 31.23, lng: 121.47 },  // Shanghai
      { lat: 22.54, lng: 114.06 },  // Shenzhen
      { lat: 22.32, lng: 114.17 },  // Hong Kong
    ],
  },
  {
    name: 'Japan Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'NTT Communications',
    countries: ['Япония'],
    year: 1996,
    description: 'Японская национальная магистраль',
    path: [
      { lat: 43.06, lng: 141.35 },  // Sapporo
      { lat: 38.27, lng: 140.87 },  // Sendai
      { lat: 35.68, lng: 139.69 },  // Tokyo
      { lat: 35.18, lng: 136.91 },  // Nagoya
      { lat: 34.69, lng: 135.50 },  // Osaka
      { lat: 33.59, lng: 130.40 },  // Fukuoka
    ],
  },
  {
    name: 'Korea-Japan Link',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'KT Corporation',
    countries: ['Южная Корея', 'Япония'],
    year: 2002,
    description: 'Канал связи Корея-Япония',
    path: [
      { lat: 37.57, lng: 126.98 },  // Seoul
      { lat: 35.18, lng: 129.08 },  // Busan
      { lat: 33.59, lng: 130.40 },  // Fukuoka
      { lat: 35.68, lng: 139.69 },  // Tokyo
    ],
  },
  {
    name: 'Southeast Asia Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Singtel',
    countries: ['Сингапур', 'Малайзия', 'Таиланд', 'Вьетнам', 'Китай'],
    year: 2006,
    description: 'Юго-восточноазиатская магистраль',
    path: [
      { lat: 1.35, lng: 103.82 },   // Singapore
      { lat: 3.14, lng: 101.69 },   // Kuala Lumpur
      { lat: 13.76, lng: 100.50 },  // Bangkok
      { lat: 21.03, lng: 105.85 },  // Hanoi
      { lat: 22.54, lng: 114.06 },  // Shenzhen
    ],
  },
  {
    name: 'India Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Tata Communications',
    countries: ['Индия'],
    year: 2005,
    description: 'Южноиндийская магистраль',
    path: [
      { lat: 19.08, lng: 72.88 },   // Mumbai
      { lat: 18.52, lng: 73.86 },   // Pune
      { lat: 17.39, lng: 78.49 },   // Hyderabad
      { lat: 12.97, lng: 77.59 },   // Bangalore
      { lat: 13.08, lng: 80.27 },   // Chennai
    ],
  },
  {
    name: 'India North Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Reliance Jio',
    countries: ['Индия'],
    year: 2008,
    description: 'Североиндийская магистраль',
    path: [
      { lat: 19.08, lng: 72.88 },   // Mumbai
      { lat: 23.02, lng: 72.57 },   // Ahmedabad
      { lat: 26.91, lng: 75.79 },   // Jaipur
      { lat: 28.61, lng: 77.21 },   // New Delhi
      { lat: 22.57, lng: 88.36 },   // Kolkata
    ],
  },
  // ── Middle East ──
  {
    name: 'Gulf Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Etisalat',
    countries: ['ОАЭ', 'Оман', 'Бахрейн', 'Катар'],
    year: 2007,
    description: 'Магистраль Персидского залива',
    path: [
      { lat: 25.20, lng: 55.27 },   // Dubai
      { lat: 24.45, lng: 54.65 },   // Abu Dhabi
      { lat: 23.59, lng: 58.38 },   // Muscat
      { lat: 26.23, lng: 50.59 },   // Bahrain
      { lat: 25.29, lng: 51.53 },   // Doha
    ],
  },
  // ── Africa ──
  {
    name: 'North Africa Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Telecom Egypt',
    countries: ['Египет', 'Алжир', 'Марокко'],
    year: 2010,
    description: 'Североафриканская магистраль',
    path: [
      { lat: 30.04, lng: 31.24 },   // Cairo
      { lat: 36.75, lng: 3.04 },    // Algiers
      { lat: 33.87, lng: -6.88 },   // Rabat
      { lat: 33.59, lng: -7.62 },   // Casablanca
    ],
  },
  {
    name: 'East Africa Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Liquid Telecom',
    countries: ['Египет', 'Судан', 'Эфиопия', 'Кения', 'Танзания'],
    year: 2012,
    description: 'Восточноафриканская магистраль',
    path: [
      { lat: 30.04, lng: 31.24 },   // Cairo
      { lat: 15.50, lng: 32.56 },   // Khartoum
      { lat: 9.02, lng: 38.75 },    // Addis Ababa
      { lat: -1.29, lng: 36.82 },   // Nairobi
      { lat: -6.79, lng: 39.28 },   // Dar es Salaam
    ],
  },
  {
    name: 'South Africa Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Telkom SA',
    countries: ['Танзания', 'Замбия', 'Зимбабве', 'ЮАР'],
    year: 2009,
    description: 'Южноафриканская магистраль',
    path: [
      { lat: -6.79, lng: 39.28 },   // Dar es Salaam
      { lat: -15.41, lng: 28.29 },  // Lusaka
      { lat: -17.83, lng: 31.05 },  // Harare
      { lat: -26.20, lng: 28.05 },  // Johannesburg
      { lat: -33.93, lng: 18.42 },  // Cape Town
    ],
  },
  // ── South America ──
  {
    name: 'Brazil Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Oi Telecom',
    countries: ['Бразилия'],
    year: 2004,
    description: 'Бразильская магистраль',
    path: [
      { lat: -3.12, lng: -60.02 },  // Manaus
      { lat: -2.50, lng: -44.28 },  // São Luís
      { lat: -8.05, lng: -34.87 },  // Recife
      { lat: -12.97, lng: -38.51 }, // Salvador
      { lat: -22.91, lng: -43.17 }, // Rio de Janeiro
      { lat: -23.55, lng: -46.63 }, // São Paulo
    ],
  },
  {
    name: 'South America West Coast',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Telefonica del Sur',
    countries: ['Эквадор', 'Перу', 'Боливия', 'Чили', 'Аргентина'],
    year: 2008,
    description: 'Западнопобережная магистраль Южной Америки',
    path: [
      { lat: -0.18, lng: -78.47 },  // Quito
      { lat: -12.05, lng: -77.04 }, // Lima
      { lat: -16.50, lng: -68.15 }, // La Paz
      { lat: -33.45, lng: -70.67 }, // Santiago
      { lat: -34.60, lng: -58.38 }, // Buenos Aires
    ],
  },
  // ── Oceania ──
  {
    name: 'Australia East Coast',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Telstra',
    countries: ['Австралия'],
    year: 2001,
    description: 'Магистраль восточного побережья Австралии',
    path: [
      { lat: -16.92, lng: 145.77 }, // Cairns
      { lat: -19.26, lng: 146.81 }, // Townsville
      { lat: -27.47, lng: 153.03 }, // Brisbane
      { lat: -33.87, lng: 151.21 }, // Sydney
      { lat: -37.81, lng: 144.96 }, // Melbourne
      { lat: -34.93, lng: 138.60 }, // Adelaide
    ],
  },
  {
    name: 'Australia Cross-Continental',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Telstra',
    countries: ['Австралия'],
    year: 2000,
    description: 'Трансконтинентальная магистраль Австралии',
    path: [
      { lat: -34.93, lng: 138.60 }, // Adelaide
      { lat: -31.95, lng: 115.86 }, // Perth
    ],
  },
  // ── Russia / Eurasia ──
  {
    name: 'Trans-Siberian Backbone',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Rostelecom',
    countries: ['Россия'],
    year: 2008,
    description: 'Транссибирская магистраль связи',
    path: [
      { lat: 55.76, lng: 37.62 },   // Moscow
      { lat: 56.84, lng: 60.60 },   // Yekaterinburg
      { lat: 55.03, lng: 73.37 },   // Omsk
      { lat: 55.03, lng: 82.92 },   // Novosibirsk
      { lat: 52.29, lng: 104.30 },  // Irkutsk
      { lat: 48.48, lng: 135.08 },  // Khabarovsk
      { lat: 43.12, lng: 131.89 },  // Vladivostok
    ],
  },
  {
    name: 'Moscow-Europe Link',
    type: 'CABLE_UNDERGROUND_FIBER',
    provider: 'Rostelecom',
    countries: ['Россия', 'Финляндия', 'Швеция'],
    year: 2006,
    description: 'Магистраль Москва-Европа',
    path: [
      { lat: 55.76, lng: 37.62 },   // Moscow
      { lat: 59.93, lng: 30.32 },   // St Petersburg
      { lat: 60.17, lng: 24.94 },   // Helsinki
      { lat: 59.33, lng: 18.07 },   // Stockholm
    ],
  },
  // ── Intercontinental copper segments (shorter runs) ──
  {
    name: 'US Midwest Copper Ring',
    type: 'CABLE_UNDERGROUND_COPPER',
    provider: 'CenturyLink',
    countries: ['США'],
    year: 1992,
    description: 'Медное кольцо Среднего Запада США',
    path: [
      { lat: 41.88, lng: -87.63 },  // Chicago
      { lat: 42.33, lng: -83.05 },  // Detroit
      { lat: 39.96, lng: -82.99 },  // Columbus
      { lat: 39.10, lng: -84.51 },  // Cincinnati
      { lat: 39.77, lng: -86.16 },  // Indianapolis
      { lat: 41.88, lng: -87.63 },  // Chicago (loop)
    ],
  },
  {
    name: 'European Copper Ring',
    type: 'CABLE_UNDERGROUND_COPPER',
    provider: 'Deutsche Telekom',
    countries: ['Германия', 'Чехия', 'Австрия', 'Венгрия'],
    year: 1994,
    description: 'Европейское медное кольцо',
    path: [
      { lat: 52.52, lng: 13.41 },   // Berlin
      { lat: 51.34, lng: 12.37 },   // Leipzig
      { lat: 51.05, lng: 13.74 },   // Dresden
      { lat: 50.08, lng: 14.44 },   // Prague
      { lat: 48.21, lng: 16.37 },   // Vienna
      { lat: 47.50, lng: 19.04 },   // Budapest
    ],
  },
  {
    name: 'China Copper Network',
    type: 'CABLE_UNDERGROUND_COPPER',
    provider: 'China Unicom',
    countries: ['Китай'],
    year: 2000,
    description: 'Медная сеть центрального Китая',
    path: [
      { lat: 39.91, lng: 116.40 },  // Beijing
      { lat: 39.14, lng: 117.18 },  // Tianjin
      { lat: 36.65, lng: 116.99 },  // Jinan
      { lat: 34.26, lng: 108.94 },  // Xi'an
      { lat: 30.57, lng: 104.07 },  // Chengdu
      { lat: 29.56, lng: 106.55 },  // Chongqing
    ],
  },
];

async function main() {
  console.log(`Import scope: ${SCOPE}`);
  console.log(`Routes to process: ${BACKBONE_ROUTES.length}`);

  if (DRY_RUN) {
    console.log('[DRY RUN] Would insert the following routes:');
    for (const route of BACKBONE_ROUTES) {
      console.log(`  - ${route.name} (${route.type}, ${route.path.length} points)`);
    }
    await prisma.$disconnect();
    return;
  }

  const providerCache = new Map();

  for (const route of BACKBONE_ROUTES) {
    const providerName = route.provider;

    if (!providerCache.has(providerName)) {
      const providerId = `global-backbone-provider-${providerName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const provider = await prisma.networkProvider.upsert({
        where: { id: providerId },
        update: { name: providerName },
        create: {
          id: providerId,
          name: providerName,
          scope: SCOPE,
          sourceUrl: 'https://en.wikipedia.org/wiki/Internet_backbone',
        },
      });
      providerCache.set(providerName, provider.id);
    }

    const providerId = providerCache.get(providerName);
    const sourceId = `global-backbone-${route.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    const metadata = {
      source: 'representative-backbone',
      points: route.path.length,
      countries: route.countries,
      year: route.year,
      description: route.description,
    };

    await prisma.networkElement.upsert({
      where: { sourceId },
      update: {
        path: route.path,
        name: route.name,
        providerId,
        type: route.type,
        metadata,
      },
      create: {
        scope: SCOPE,
        type: route.type,
        name: route.name,
        sourceId,
        providerId,
        path: route.path,
        metadata,
      },
    });
  }

  console.log(`Prepared ${BACKBONE_ROUTES.length} backbone cable route(s).`);
  console.log('Import finished OK.');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
