/**
 * Populate representative global data centers and Internet Exchange (IX) points.
 *
 * Uses real-world locations and names. Suitable for diploma project visualization.
 * Idempotency: uses sourceId prefix "major-dc-" with upsert.
 *
 * Usage:
 *   node scripts/sync-major-datacenters.mjs
 *   node scripts/sync-major-datacenters.mjs --dry-run
 */

import { PrismaClient } from '@prisma/client';
import {
  resolveProviderSourceUrl,
  resolveServerSourceUrl,
  wikipediaSearchUrl,
} from './lib/resolve-server-source-url.mjs';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const SCOPE = 'GLOBAL';
const MAJOR_DATACENTERS_DATASET = 'major-datacenters';

const WP = (q) => wikipediaSearchUrl(q);
const AWS_REGIONS_DOC =
  'https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html';

const FACILITIES = [
  // ── Major Data Centers ──
  {
    name: 'Equinix DC1-DC15 Ashburn',
    type: 'SERVER',
    lat: 39.0438,
    lng: -77.4874,
    operator: 'Equinix',
    year: 2000,
    capacity: '1000+ MW',
    description: 'Крупнейший кластер дата-центров в мире (Data Center Alley)',
    country: 'США',
    officialUrl: 'https://www.equinix.com/data-centers/americas-colocation/united-states-colocation',
    sourceNote: 'Northern Virginia / Ashburn (Data Center Alley)',
  },
  {
    name: 'Equinix FR5 Frankfurt',
    type: 'SERVER',
    lat: 50.1109,
    lng: 8.6821,
    operator: 'Equinix',
    year: 2003,
    capacity: '100+ MW',
    description: 'Основной европейский хаб Equinix',
    country: 'Германия',
    officialUrl: WP('Equinix FR5 Frankfurt data center'),
  },
  {
    name: 'Equinix SG3 Singapore',
    type: 'SERVER',
    lat: 1.3521,
    lng: 103.8198,
    operator: 'Equinix',
    year: 2014,
    capacity: '50+ MW',
    description: 'Юго-восточноазиатский хаб Equinix',
    country: 'Сингапур',
    officialUrl: 'https://www.equinix.com/data-centers/asia-pacific-colocation/singapore-colocation',
  },
  {
    name: 'Equinix TY1 Tokyo',
    type: 'SERVER',
    lat: 35.6762,
    lng: 139.6503,
    operator: 'Equinix',
    year: 2002,
    capacity: '60+ MW',
    description: 'Токийский дата-центр Equinix',
    country: 'Япония',
    officialUrl: 'https://www.equinix.com/data-centers/asia-pacific-colocation/japan-colocation/tokyo-data-centers',
  },
  {
    name: 'Equinix LD8 London',
    type: 'SERVER',
    lat: 51.5194,
    lng: -0.0226,
    operator: 'Equinix',
    year: 2007,
    capacity: '80+ MW',
    description: 'Лондонский дата-центр Equinix (Docklands)',
    country: 'Великобритания',
    officialUrl: WP('Equinix LD8 London Docklands data center'),
  },
  {
    name: 'Equinix SY4 Sydney',
    type: 'SERVER',
    lat: -33.8688,
    lng: 151.2093,
    operator: 'Equinix',
    year: 2017,
    capacity: '30+ MW',
    description: 'Австралийский хаб Equinix',
    country: 'Австралия',
    officialUrl: 'https://www.equinix.com/data-centers/asia-pacific-colocation/australia-colocation/sydney-data-centers',
  },

  {
    name: 'AWS US-East-1 (Virginia)',
    type: 'SERVER',
    lat: 39.0438,
    lng: -77.4874,
    operator: 'Amazon Web Services',
    year: 2006,
    capacity: '500+ MW',
    description: 'Крупнейший облачный регион AWS',
    country: 'США',
    officialUrl: AWS_REGIONS_DOC,
    sourceNote: 'Регион AWS: us-east-1 (N. Virginia)',
  },
  {
    name: 'AWS EU-West-1 (Ireland)',
    type: 'SERVER',
    lat: 53.3498,
    lng: -6.2603,
    operator: 'Amazon Web Services',
    year: 2007,
    capacity: '200+ MW',
    description: 'Европейский регион AWS в Ирландии',
    country: 'Ирландия',
    officialUrl: AWS_REGIONS_DOC,
    sourceNote: 'Регион AWS: eu-west-1 (Ireland)',
  },
  {
    name: 'AWS AP-Northeast-1 (Tokyo)',
    type: 'SERVER',
    lat: 35.6895,
    lng: 139.6917,
    operator: 'Amazon Web Services',
    year: 2011,
    capacity: '100+ MW',
    description: 'Азиатско-Тихоокеанский регион AWS',
    country: 'Япония',
    officialUrl: AWS_REGIONS_DOC,
    sourceNote: 'Регион AWS: ap-northeast-1 (Tokyo)',
  },
  {
    name: 'AWS AP-Southeast-1 (Singapore)',
    type: 'SERVER',
    lat: 1.2903,
    lng: 103.852,
    operator: 'Amazon Web Services',
    year: 2010,
    capacity: '80+ MW',
    description: 'Регион AWS в Сингапуре',
    country: 'Сингапур',
    officialUrl: AWS_REGIONS_DOC,
    sourceNote: 'Регион AWS: ap-southeast-1 (Singapore)',
  },

  {
    name: 'Google Council Bluffs DC',
    type: 'SERVER',
    lat: 41.2619,
    lng: -95.8608,
    operator: 'Google',
    year: 2009,
    capacity: '400+ MW',
    description: 'Крупнейший дата-центр Google в Айове',
    country: 'США',
    officialUrl: 'https://www.google.com/about/datacenters/inside/locations/council-bluffs/',
  },
  {
    name: 'Google The Dalles DC',
    type: 'SERVER',
    lat: 45.5946,
    lng: -121.1787,
    operator: 'Google',
    year: 2006,
    capacity: '200+ MW',
    description: 'Дата-центр Google в Орегоне',
    country: 'США',
    officialUrl: 'https://www.google.com/about/datacenters/inside/locations/the-dalles/',
  },
  {
    name: 'Google Hamina DC',
    type: 'SERVER',
    lat: 60.5693,
    lng: 27.1878,
    operator: 'Google',
    year: 2011,
    capacity: '100+ MW',
    description: 'Европейский дата-центр Google в Финляндии',
    country: 'Финляндия',
    officialUrl: 'https://www.google.com/about/datacenters/inside/locations/hamina/',
  },
  {
    name: 'Google Changhua DC',
    type: 'SERVER',
    lat: 24.0518,
    lng: 120.5161,
    operator: 'Google',
    year: 2013,
    capacity: '80+ MW',
    description: 'Дата-центр Google на Тайване',
    country: 'Тайвань',
    officialUrl: 'https://www.google.com/about/datacenters/inside/locations/changhua-county/',
  },

  {
    name: 'Microsoft Azure West US',
    type: 'SERVER',
    lat: 47.2332,
    lng: -119.8526,
    operator: 'Microsoft',
    year: 2010,
    capacity: '300+ MW',
    description: 'Регион Azure на западе США (Квинси)',
    country: 'США',
    officialUrl: WP('Microsoft Azure West US region Washington Quincy'),
  },
  {
    name: 'Microsoft Azure West Europe',
    type: 'SERVER',
    lat: 52.3667,
    lng: 4.9,
    operator: 'Microsoft',
    year: 2014,
    capacity: '200+ MW',
    description: 'Регион Azure в Нидерландах',
    country: 'Нидерланды',
    officialUrl: WP('Microsoft Azure West Europe region Netherlands'),
  },
  {
    name: 'Microsoft Azure Japan East',
    type: 'SERVER',
    lat: 35.632,
    lng: 139.882,
    operator: 'Microsoft',
    year: 2014,
    capacity: '60+ MW',
    description: 'Регион Azure в Токио (Сайтама)',
    country: 'Япония',
    officialUrl: WP('Microsoft Azure Japan East region Tokyo Saitama'),
  },

  {
    name: 'Yandex Владимир DC',
    type: 'SERVER',
    lat: 56.129,
    lng: 40.407,
    operator: 'Яндекс',
    year: 2013,
    capacity: '40+ MW',
    description: 'Крупнейший дата-центр Яндекса',
    country: 'Россия',
    officialUrl: 'https://yandex.cloud/en/docs/overview/concepts/geo-scope',
    sourceNote: 'Дата-центр во Владимире (Yandex Cloud)',
  },
  {
    name: 'Yandex Сасово DC',
    type: 'SERVER',
    lat: 54.35,
    lng: 41.92,
    operator: 'Яндекс',
    year: 2017,
    capacity: '30+ MW',
    description: 'Дата-центр Яндекса в Рязанской области',
    country: 'Россия',
    officialUrl: 'https://yandex.cloud/en/docs/overview/concepts/geo-scope',
    sourceNote: 'Дата-центр в Сасово (Yandex Cloud)',
  },

  {
    name: 'Alibaba Cloud Hangzhou',
    type: 'SERVER',
    lat: 30.2741,
    lng: 120.1551,
    operator: 'Alibaba Cloud',
    year: 2015,
    capacity: '150+ MW',
    description: 'Основной дата-центр Alibaba Cloud',
    country: 'Китай',
    officialUrl: 'https://www.alibabacloud.com/help/en/doc-detail/40654.html',
    sourceNote: 'Регион China (Hangzhou)',
  },
  {
    name: 'Tencent Cloud Shenzhen',
    type: 'SERVER',
    lat: 22.5431,
    lng: 114.0579,
    operator: 'Tencent',
    year: 2016,
    capacity: '100+ MW',
    description: 'Дата-центр Tencent Cloud в Шэньчжэне',
    country: 'Китай',
    officialUrl: 'https://www.tencentcloud.com/document/product/213/6091',
    sourceNote: 'Регионы и зоны Tencent Cloud (Shenzhen)',
  },

  // ── Internet Exchange Points (IXP) ──
  {
    name: 'DE-CIX Frankfurt',
    type: 'SERVER',
    lat: 50.1109,
    lng: 8.6821,
    operator: 'DE-CIX',
    year: 1995,
    capacity: '14+ Тбит/с',
    description: 'Крупнейшая точка обмена трафиком в мире',
    country: 'Германия',
    officialUrl: 'https://www.de-cix.net/en/locations/frankfurt',
  },
  {
    name: 'AMS-IX Amsterdam',
    type: 'SERVER',
    lat: 52.3676,
    lng: 4.9041,
    operator: 'AMS-IX',
    year: 1997,
    capacity: '10+ Тбит/с',
    description: 'Амстердамская точка обмена трафиком',
    country: 'Нидерланды',
    officialUrl: 'https://www.ams-ix.net/ams-ix-internet-services/amsterdam',
  },
  {
    name: 'LINX London',
    type: 'SERVER',
    lat: 51.5194,
    lng: -0.0226,
    operator: 'LINX',
    year: 1994,
    capacity: '6+ Тбит/с',
    description: 'Лондонская точка обмена трафиком',
    country: 'Великобритания',
    officialUrl: WP('London Internet Exchange LINX'),
  },
  {
    name: 'MSK-IX Москва',
    type: 'SERVER',
    lat: 55.7558,
    lng: 37.6173,
    operator: 'MSK-IX',
    year: 1995,
    capacity: '3+ Тбит/с',
    description: 'Московская точка обмена трафиком',
    country: 'Россия',
    officialUrl: 'https://www.msk-ix.ru/',
  },
  {
    name: 'JPNAP Tokyo',
    type: 'SERVER',
    lat: 35.6762,
    lng: 139.6503,
    operator: 'JPNAP',
    year: 2001,
    capacity: '3+ Тбит/с',
    description: 'Токийская точка обмена трафиком',
    country: 'Япония',
    officialUrl: 'https://www.jpnap.net/',
  },
  {
    name: 'Equinix IX São Paulo',
    type: 'SERVER',
    lat: -23.5505,
    lng: -46.6333,
    operator: 'Equinix',
    year: 2012,
    capacity: '2+ Тбит/с',
    description: 'Крупнейший IXP Южной Америки',
    country: 'Бразилия',
    officialUrl: 'https://www.equinix.com/data-centers/americas-colocation/brazil-colocation/sao-paulo-data-centers',
    sourceNote: 'IX в экосистеме Equinix São Paulo',
  },
  {
    name: 'HKIX Hong Kong',
    type: 'SERVER',
    lat: 22.3193,
    lng: 114.1694,
    operator: 'HKIX',
    year: 1995,
    capacity: '2+ Тбит/с',
    description: 'Точка обмена трафиком Гонконга',
    country: 'Гонконг',
    officialUrl: 'https://www.hkix.net/',
  },
  {
    name: 'SGIX Singapore',
    type: 'SERVER',
    lat: 1.3521,
    lng: 103.8198,
    operator: 'SGIX',
    year: 2009,
    capacity: '1+ Тбит/с',
    description: 'Сингапурская точка обмена трафиком',
    country: 'Сингапур',
    officialUrl: 'https://www.sgix.org/',
  },
  {
    name: 'France-IX Paris',
    type: 'SERVER',
    lat: 48.8566,
    lng: 2.3522,
    operator: 'France-IX',
    year: 2010,
    capacity: '4+ Тбит/с',
    description: 'Парижская точка обмена трафиком',
    country: 'Франция',
    officialUrl: 'https://www.franceix.net/',
  },
  {
    name: 'NAPAfrica Johannesburg',
    type: 'SERVER',
    lat: -26.2041,
    lng: 28.0473,
    operator: 'NAPAfrica',
    year: 2012,
    capacity: '0.5+ Тбит/с',
    description: 'Крупнейший IXP Африки',
    country: 'ЮАР',
    officialUrl: 'https://www.napafrica.net/',
  },
  {
    name: 'MIX Milan',
    type: 'SERVER',
    lat: 45.4642,
    lng: 9.19,
    operator: 'MIX',
    year: 2000,
    capacity: '1.5+ Тбит/с',
    description: 'Миланская точка обмена трафиком',
    country: 'Италия',
    officialUrl: 'https://www.mix-it.net/',
  },
  {
    name: 'KINX Seoul',
    type: 'SERVER',
    lat: 37.5665,
    lng: 126.978,
    operator: 'KINX',
    year: 2002,
    capacity: '2+ Тбит/с',
    description: 'Корейская точка обмена трафиком',
    country: 'Южная Корея',
    officialUrl: 'https://www.kinx.net/',
  },
  {
    name: 'UAE-IX Dubai',
    type: 'SERVER',
    lat: 25.2048,
    lng: 55.2708,
    operator: 'UAE-IX',
    year: 2014,
    capacity: '0.5+ Тбит/с',
    description: 'Дубайская точка обмена трафиком',
    country: 'ОАЭ',
    officialUrl: 'https://uae-ix.net/',
  },
  {
    name: 'CATNIX Barcelona',
    type: 'SERVER',
    lat: 41.3874,
    lng: 2.1686,
    operator: 'CATNIX',
    year: 2003,
    capacity: '0.2+ Тбит/с',
    description: 'Каталонская точка обмена трафиком',
    country: 'Испания',
    officialUrl: 'https://www.catnix.cat/',
  },
];

function buildProviderSourceUrl(operator) {
  return resolveProviderSourceUrl({ operator }) ?? null;
}

function buildFacilityMetadata(facility) {
  return {
    dataset: MAJOR_DATACENTERS_DATASET,
    operator: facility.operator,
    year: facility.year,
    capacity: facility.capacity,
    description: facility.description,
    country: facility.country,
    source: MAJOR_DATACENTERS_DATASET,
    ...(facility.officialUrl ? { officialUrl: facility.officialUrl } : {}),
    ...(facility.sourceNote ? { sourceNote: facility.sourceNote } : {}),
  };
}

function buildFacilitySourceUrl(facility) {
  const providerSourceUrl = buildProviderSourceUrl(facility.operator);
  return (
    resolveServerSourceUrl({
      name: facility.name,
      operator: facility.operator,
      country: facility.country,
      metadata: buildFacilityMetadata(facility),
      providerSourceUrl,
    }) ?? providerSourceUrl
  );
}

async function main() {
  console.log(`Facilities to process: ${FACILITIES.length}`);

  if (DRY_RUN) {
    console.log('[DRY RUN] Would insert:');
    for (const f of FACILITIES) console.log(`  - ${f.name} (${f.type}, ${f.operator})`);
    await prisma.$disconnect();
    return;
  }

  const providerCache = new Map();

  for (const f of FACILITIES) {
    const provKey = f.operator;
    if (!providerCache.has(provKey)) {
      const providerId = `major-dc-provider-${provKey.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const provider = await prisma.networkProvider.upsert({
        where: { id: providerId },
        update: {
          name: provKey,
          sourceUrl: buildProviderSourceUrl(provKey),
        },
        create: {
          id: providerId,
          name: provKey,
          scope: SCOPE,
          sourceUrl: buildProviderSourceUrl(provKey),
        },
      });
      providerCache.set(provKey, provider.id);
    }

    const providerId = providerCache.get(provKey);
    const sourceId = `major-dc-${f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    const metadata = buildFacilityMetadata(f);

    await prisma.networkElement.upsert({
      where: { sourceId },
      update: {
        name: f.name,
        type: f.type,
        lat: f.lat,
        lng: f.lng,
        sourceUrl: buildFacilitySourceUrl(f),
        providerId,
        metadata,
      },
      create: {
        scope: SCOPE,
        type: f.type,
        name: f.name,
        sourceId,
        providerId,
        lat: f.lat,
        lng: f.lng,
        sourceUrl: buildFacilitySourceUrl(f),
        metadata,
      },
    });
  }

  console.log(`Imported ${FACILITIES.length} data centers and IX points.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
