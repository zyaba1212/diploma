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

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const SCOPE = 'GLOBAL';
const WIKIPEDIA_SEARCH_PREFIX = 'https://en.wikipedia.org/w/index.php?title=Special:Search&search=';

const FACILITIES = [
  // ── Major Data Centers ──
  { name: 'Equinix DC1-DC15 Ashburn', type: 'SERVER', lat: 39.0438, lng: -77.4874, operator: 'Equinix', year: 2000, capacity: '1000+ MW', description: 'Крупнейший кластер дата-центров в мире (Data Center Alley)', country: 'США' },
  { name: 'Equinix FR5 Frankfurt', type: 'SERVER', lat: 50.1109, lng: 8.6821, operator: 'Equinix', year: 2003, capacity: '100+ MW', description: 'Основной европейский хаб Equinix', country: 'Германия' },
  { name: 'Equinix SG3 Singapore', type: 'SERVER', lat: 1.3521, lng: 103.8198, operator: 'Equinix', year: 2014, capacity: '50+ MW', description: 'Юго-восточноазиатский хаб Equinix', country: 'Сингапур' },
  { name: 'Equinix TY1 Tokyo', type: 'SERVER', lat: 35.6762, lng: 139.6503, operator: 'Equinix', year: 2002, capacity: '60+ MW', description: 'Токийский дата-центр Equinix', country: 'Япония' },
  { name: 'Equinix LD8 London', type: 'SERVER', lat: 51.5194, lng: -0.0226, operator: 'Equinix', year: 2007, capacity: '80+ MW', description: 'Лондонский дата-центр Equinix (Docklands)', country: 'Великобритания' },
  { name: 'Equinix SY4 Sydney', type: 'SERVER', lat: -33.8688, lng: 151.2093, operator: 'Equinix', year: 2017, capacity: '30+ MW', description: 'Австралийский хаб Equinix', country: 'Австралия' },

  { name: 'AWS US-East-1 (Virginia)', type: 'SERVER', lat: 39.0438, lng: -77.4874, operator: 'Amazon Web Services', year: 2006, capacity: '500+ MW', description: 'Крупнейший облачный регион AWS', country: 'США' },
  { name: 'AWS EU-West-1 (Ireland)', type: 'SERVER', lat: 53.3498, lng: -6.2603, operator: 'Amazon Web Services', year: 2007, capacity: '200+ MW', description: 'Европейский регион AWS в Ирландии', country: 'Ирландия' },
  { name: 'AWS AP-Northeast-1 (Tokyo)', type: 'SERVER', lat: 35.6895, lng: 139.6917, operator: 'Amazon Web Services', year: 2011, capacity: '100+ MW', description: 'Азиатско-Тихоокеанский регион AWS', country: 'Япония' },
  { name: 'AWS AP-Southeast-1 (Singapore)', type: 'SERVER', lat: 1.2903, lng: 103.8520, operator: 'Amazon Web Services', year: 2010, capacity: '80+ MW', description: 'Регион AWS в Сингапуре', country: 'Сингапур' },

  { name: 'Google Council Bluffs DC', type: 'SERVER', lat: 41.2619, lng: -95.8608, operator: 'Google', year: 2009, capacity: '400+ MW', description: 'Крупнейший дата-центр Google в Айове', country: 'США' },
  { name: 'Google The Dalles DC', type: 'SERVER', lat: 45.5946, lng: -121.1787, operator: 'Google', year: 2006, capacity: '200+ MW', description: 'Дата-центр Google в Орегоне', country: 'США' },
  { name: 'Google Hamina DC', type: 'SERVER', lat: 60.5693, lng: 27.1878, operator: 'Google', year: 2011, capacity: '100+ MW', description: 'Европейский дата-центр Google в Финляндии', country: 'Финляндия' },
  { name: 'Google Changhua DC', type: 'SERVER', lat: 24.0518, lng: 120.5161, operator: 'Google', year: 2013, capacity: '80+ MW', description: 'Дата-центр Google на Тайване', country: 'Тайвань' },

  { name: 'Microsoft Azure West US', type: 'SERVER', lat: 47.2332, lng: -119.8526, operator: 'Microsoft', year: 2010, capacity: '300+ MW', description: 'Регион Azure на западе США (Квинси)', country: 'США' },
  { name: 'Microsoft Azure West Europe', type: 'SERVER', lat: 52.3667, lng: 4.9000, operator: 'Microsoft', year: 2014, capacity: '200+ MW', description: 'Регион Azure в Нидерландах', country: 'Нидерланды' },
  { name: 'Microsoft Azure Japan East', type: 'SERVER', lat: 35.6320, lng: 139.8820, operator: 'Microsoft', year: 2014, capacity: '60+ MW', description: 'Регион Azure в Токио (Сайтама)', country: 'Япония' },

  { name: 'Yandex Владимир DC', type: 'SERVER', lat: 56.1290, lng: 40.4070, operator: 'Яндекс', year: 2013, capacity: '40+ MW', description: 'Крупнейший дата-центр Яндекса', country: 'Россия' },
  { name: 'Yandex Сасово DC', type: 'SERVER', lat: 54.3500, lng: 41.9200, operator: 'Яндекс', year: 2017, capacity: '30+ MW', description: 'Дата-центр Яндекса в Рязанской области', country: 'Россия' },

  { name: 'Alibaba Cloud Hangzhou', type: 'SERVER', lat: 30.2741, lng: 120.1551, operator: 'Alibaba Cloud', year: 2015, capacity: '150+ MW', description: 'Основной дата-центр Alibaba Cloud', country: 'Китай' },
  { name: 'Tencent Cloud Shenzhen', type: 'SERVER', lat: 22.5431, lng: 114.0579, operator: 'Tencent', year: 2016, capacity: '100+ MW', description: 'Дата-центр Tencent Cloud в Шэньчжэне', country: 'Китай' },

  // ── Internet Exchange Points (IXP) ──
  { name: 'DE-CIX Frankfurt', type: 'PROVIDER', lat: 50.1109, lng: 8.6821, operator: 'DE-CIX', year: 1995, capacity: '14+ Тбит/с', description: 'Крупнейшая точка обмена трафиком в мире', country: 'Германия' },
  { name: 'AMS-IX Amsterdam', type: 'PROVIDER', lat: 52.3676, lng: 4.9041, operator: 'AMS-IX', year: 1997, capacity: '10+ Тбит/с', description: 'Амстердамская точка обмена трафиком', country: 'Нидерланды' },
  { name: 'LINX London', type: 'PROVIDER', lat: 51.5194, lng: -0.0226, operator: 'LINX', year: 1994, capacity: '6+ Тбит/с', description: 'Лондонская точка обмена трафиком', country: 'Великобритания' },
  { name: 'MSK-IX Москва', type: 'PROVIDER', lat: 55.7558, lng: 37.6173, operator: 'MSK-IX', year: 1995, capacity: '3+ Тбит/с', description: 'Московская точка обмена трафиком', country: 'Россия' },
  { name: 'JPNAP Tokyo', type: 'PROVIDER', lat: 35.6762, lng: 139.6503, operator: 'JPNAP', year: 2001, capacity: '3+ Тбит/с', description: 'Токийская точка обмена трафиком', country: 'Япония' },
  { name: 'Equinix IX São Paulo', type: 'PROVIDER', lat: -23.5505, lng: -46.6333, operator: 'Equinix', year: 2012, capacity: '2+ Тбит/с', description: 'Крупнейший IXP Южной Америки', country: 'Бразилия' },
  { name: 'HKIX Hong Kong', type: 'PROVIDER', lat: 22.3193, lng: 114.1694, operator: 'HKIX', year: 1995, capacity: '2+ Тбит/с', description: 'Точка обмена трафиком Гонконга', country: 'Гонконг' },
  { name: 'SGIX Singapore', type: 'PROVIDER', lat: 1.3521, lng: 103.8198, operator: 'SGIX', year: 2009, capacity: '1+ Тбит/с', description: 'Сингапурская точка обмена трафиком', country: 'Сингапур' },
  { name: 'France-IX Paris', type: 'PROVIDER', lat: 48.8566, lng: 2.3522, operator: 'France-IX', year: 2010, capacity: '4+ Тбит/с', description: 'Парижская точка обмена трафиком', country: 'Франция' },
  { name: 'NAPAfrica Johannesburg', type: 'PROVIDER', lat: -26.2041, lng: 28.0473, operator: 'NAPAfrica', year: 2012, capacity: '0.5+ Тбит/с', description: 'Крупнейший IXP Африки', country: 'ЮАР' },
  { name: 'MIX Milan', type: 'PROVIDER', lat: 45.4642, lng: 9.1900, operator: 'MIX', year: 2000, capacity: '1.5+ Тбит/с', description: 'Миланская точка обмена трафиком', country: 'Италия' },
  { name: 'KINX Seoul', type: 'PROVIDER', lat: 37.5665, lng: 126.9780, operator: 'KINX', year: 2002, capacity: '2+ Тбит/с', description: 'Корейская точка обмена трафиком', country: 'Южная Корея' },
  { name: 'UAE-IX Dubai', type: 'PROVIDER', lat: 25.2048, lng: 55.2708, operator: 'UAE-IX', year: 2014, capacity: '0.5+ Тбит/с', description: 'Дубайская точка обмена трафиком', country: 'ОАЭ' },
  { name: 'CATNIX Barcelona', type: 'PROVIDER', lat: 41.3874, lng: 2.1686, operator: 'CATNIX', year: 2003, capacity: '0.2+ Тбит/с', description: 'Каталонская точка обмена трафиком', country: 'Испания' },
];

function wikipediaSearchUrl(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  return `${WIKIPEDIA_SEARCH_PREFIX}${encodeURIComponent(q)}`;
}

function awsRegionSourceUrl(name) {
  const m = String(name).match(/\b([a-z]{2}-[a-z]+-\d)\b/i);
  if (!m) return null;
  const region = m[1].toLowerCase();
  return `https://aws.amazon.com/about-aws/global-infrastructure/regions_az/${encodeURIComponent(region)}/`;
}

function buildProviderSourceUrl(operator) {
  const fallback = wikipediaSearchUrl(operator);
  return fallback ?? null;
}

function buildFacilitySourceUrl(facility) {
  if (facility.operator === 'Amazon Web Services') {
    const awsRegion = awsRegionSourceUrl(facility.name);
    if (awsRegion) return awsRegion;
  }
  const specific = wikipediaSearchUrl(facility.name);
  if (specific) return specific;
  return buildProviderSourceUrl(facility.operator);
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

    await prisma.networkElement.upsert({
      where: { sourceId },
      update: {
        name: f.name,
        type: f.type,
        lat: f.lat,
        lng: f.lng,
        sourceUrl: buildFacilitySourceUrl(f),
        providerId,
        metadata: {
          operator: f.operator,
          year: f.year,
          capacity: f.capacity,
          description: f.description,
          country: f.country,
          source: 'major-datacenters',
        },
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
        metadata: {
          operator: f.operator,
          year: f.year,
          capacity: f.capacity,
          description: f.description,
          country: f.country,
          source: 'major-datacenters',
        },
      },
    });
  }

  console.log(`Imported ${FACILITIES.length} data centers and IX points.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
