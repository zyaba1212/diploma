/** Ссылки на внешние источники для подсказок кабелей (без «сырого» имени в href). */

export type CableSourceLink = {
  href: string;
  label: string;
  domain: string;
  note?: string;
};

export function isSafeExternalHttpUrl(url: string): boolean {
  const t = url.trim();
  if (/\s/.test(t)) return false;
  if (!t.startsWith('http://') && !t.startsWith('https://')) return false;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Поиск в англоязычной Wikipedia; query только в query-string, не в path. */
export function wikipediaSearchUrlEn(cableName: string): string | null {
  const q = normalizeCableLookupName(cableName);
  if (!q) return null;
  const query = /\bcable\b/i.test(q) ? q : `${q} submarine cable`;
  return `https://en.wikipedia.org/w/index.php?title=Special:Search&search=${encodeURIComponent(query)}`;
}

export function isSubmarineCableElementType(elType: string): boolean {
  return elType === 'CABLE_FIBER' || elType === 'CABLE_COPPER';
}

function isSatelliteElementType(elType: string): boolean {
  return elType === 'SATELLITE' || elType === 'SATELLITE_RASSVET';
}

export function buildCelestrakNameSearchUrl(name: string): string | null {
  const normalized = name.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return `https://celestrak.org/satcat/records.php?NAME=${encodeURIComponent(normalized)}&ONORBIT=1`;
}

/**
 * Убираем служебный сегментный суффикс, который добавляется при импорте
 * MultiLineString-геометрий: "Equiano (6/6)" -> "Equiano".
 */
export function normalizeCableLookupName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\s*\(\d+\/\d+\)\s*$/u, '').replace(/\s+/g, ' ').trim();
}

/**
 * Для импортов Open Undersea Cable Map даём детальную карточку кабеля в GitHub (blob), а не raw JSON.
 */
export function openUnderseaCableDetailBlobUrl(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const meta = metadata as Record<string, unknown>;
  if (meta.dataset !== 'open_undersea_cable_map') return null;
  const cableId = typeof meta.cableId === 'string' ? meta.cableId.trim() : '';
  if (!cableId) return null;
  return `https://github.com/stevesong/open_undersea_cable_map/blob/main/cable/${encodeURIComponent(cableId)}.json`;
}

export function urlDomain(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return '';
  }
}

function sameHttpUrl(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a.trim() === b.trim();
  }
}

function firstSafeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalize = (candidate: string): string | null => {
    let value = candidate.trim();
    if (!value) return null;
    if (isSafeExternalHttpUrl(value)) return value;
    // Handle common trailing punctuation/annotations around copied URLs.
    while (/[)\].,;:!?]$/.test(value)) {
      value = value.slice(0, -1).trimEnd();
      if (isSafeExternalHttpUrl(value)) return value;
    }
    return null;
  };
  const direct = normalize(trimmed);
  if (direct) return direct;
  const m = trimmed.match(/https?:\/\/\S+/i);
  if (!m) return null;
  return normalize(m[0]);
}

function metadataObject(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return null;
  return metadata as Record<string, unknown>;
}

function isCelestrakSatelliteCard(elType: string, metadata: unknown): boolean {
  if (!isSatelliteElementType(elType)) return false;
  const meta = metadataObject(metadata);
  return meta?.dataset === 'celestrak-tle';
}

function datasetReferenceLink(
  elType: string,
  metadata: unknown,
  satelliteNameQuery?: string | null,
  satelliteElementName?: string | null,
): CableSourceLink | null {
  const meta = metadataObject(metadata);
  if (!meta) return null;

  if (isSubmarineCableElementType(elType)) {
    const datasetDetail = openUnderseaCableDetailBlobUrl(meta);
    if (datasetDetail) {
      return {
        href: datasetDetail,
        label: 'Техническая запись кабеля (JSON)',
        domain: urlDomain(datasetDetail),
      };
    }
  }

  const dataset = typeof meta.dataset === 'string' ? meta.dataset : '';
  if (dataset === 'openstreetmap' || dataset === 'osm_terrestrial_fibre') {
    const osm = meta.osm && typeof meta.osm === 'object' ? (meta.osm as Record<string, unknown>) : null;
    const rawId = osm?.id ?? osm?.wayId ?? osm?.nodeId ?? osm?.relationId;
    const osmId = typeof rawId === 'number' || typeof rawId === 'string' ? String(rawId).trim() : '';
    const osmTypeRaw = typeof osm?.type === 'string' ? osm.type.trim().toLowerCase() : '';
    let osmType: 'node' | 'way' | 'relation' | '' =
      osmTypeRaw === 'node' || osmTypeRaw === 'way' || osmTypeRaw === 'relation' ? osmTypeRaw : '';
    if (!osmType) {
      if (osm?.wayId != null) osmType = 'way';
      else if (osm?.nodeId != null) osmType = 'node';
      else if (osm?.relationId != null) osmType = 'relation';
    }
    if (osmId && osmType) {
      const href = `https://www.openstreetmap.org/${osmType}/${encodeURIComponent(osmId)}`;
      return {
        href,
        label: 'Объект в OpenStreetMap',
        domain: urlDomain(href),
      };
    }
  }

  if (dataset === 'afterfibre') {
    const href = 'https://afterfibre.nsrc.org/';
    return {
      href,
      label: 'AfTerFibre (African terrestrial fibre)',
      domain: urlDomain(href),
      note: 'Данные CC-BY 4.0 AfTerFibre / NSRC; точная геометрия может отличаться.',
    };
  }

  if (dataset === 'gold_coast_fibre_optic_cable') {
    const href = 'https://data.gov.au/data/dataset/fibre-optic-cable';
    return {
      href,
      label: 'Датасет кабелей (data.gov.au)',
      domain: urlDomain(href),
    };
  }

  if (dataset === 'celestrak-tle') {
    const satelliteNameForSearch = satelliteNameQuery ?? satelliteElementName ?? '';
    const href =
      isSatelliteElementType(elType) && satelliteNameForSearch
        ? (buildCelestrakNameSearchUrl(satelliteNameForSearch) ?? 'https://celestrak.org/NORAD/elements/')
        : 'https://celestrak.org/NORAD/elements/';
    return {
      href,
      label: 'Каталог орбитальных данных (Celestrak)',
      domain: urlDomain(href),
    };
  }

  return null;
}

export function cableSourceLinks(params: {
  elType: string;
  cableName?: string | null;
  metadata?: unknown;
  elementSourceUrl?: string | null;
  providerSourceUrl?: string | null;
  satelliteNameQuery?: string | null;
}): CableSourceLink[] {
  const { elType, cableName, metadata, elementSourceUrl, providerSourceUrl, satelliteNameQuery } = params;
  const links: CableSourceLink[] = [];
  const seen = new Set<string>();
  const pushUnique = (link: CableSourceLink) => {
    const key = `${link.href}|${link.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(link);
  };

  const meta = metadataObject(metadata);
  const official =
    firstSafeHttpUrl(meta?.officialUrl) ??
    firstSafeHttpUrl(meta?.projectUrl) ??
    firstSafeHttpUrl(meta?.url) ??
    null;
  const elementSource = firstSafeHttpUrl(elementSourceUrl);
  const providerSource = firstSafeHttpUrl(providerSourceUrl);
  const isServer = elType === 'SERVER';
  const isSubmarine = isSubmarineCableElementType(elType);
  const isCelestrakSatellite = isCelestrakSatelliteCard(elType, meta);

  if (isServer && elementSource) {
    pushUnique({
      href: elementSource,
      label: 'Источник сервера',
      domain: urlDomain(elementSource),
    });
  }

  if (official && !(isServer && elementSource && sameHttpUrl(official, elementSource))) {
    pushUnique({
      href: official,
      label: 'Сайт проекта / оператора',
      domain: urlDomain(official),
      note: 'URL из открытого датасета, иногда это общий сайт компании.',
    });
  }

  // For server cards, provider-level URL is only a final fallback.
  if (
    providerSource &&
    (!isServer || (!elementSource && !official)) &&
    !isCelestrakSatellite &&
    meta?.dataset !== 'afterfibre'
  ) {
    pushUnique({
      href: providerSource,
      label: 'Источник провайдера',
      domain: urlDomain(providerSource),
    });
  }

  const datasetRef = datasetReferenceLink(elType, meta, satelliteNameQuery, cableName);
  if (datasetRef) pushUnique(datasetRef);
  if (isCelestrakSatellite) {
    const noradElementsHref = 'https://celestrak.org/NORAD/elements/';
    if (datasetRef?.href !== noradElementsHref) {
      pushUnique({
        href: noradElementsHref,
        label: 'Раздел TLE (NORAD elements)',
        domain: urlDomain(noradElementsHref),
      });
    }
  }

  if (isSubmarine && cableName?.trim()) {
    const wiki = wikipediaSearchUrlEn(cableName);
    if (wiki) {
      pushUnique({
        href: wiki,
        label: 'Поиск в Wikipedia (EN)',
        domain: urlDomain(wiki),
        note: 'Справочный поиск, не официальное подтверждение трассы.',
      });
    }
  }

  return links;
}
