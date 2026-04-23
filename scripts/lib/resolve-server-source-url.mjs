const WIKIPEDIA_SEARCH_PREFIX = 'https://en.wikipedia.org/w/index.php?title=Special:Search&search=';

/** Known generic operator marketing pages (lowest priority for server cards). */
const OPERATOR_OFFICIAL_URLS = new Map([
  ['amazon web services', 'https://aws.amazon.com/about-aws/global-infrastructure/'],
  ['microsoft', 'https://azure.microsoft.com/en-us/explore/global-infrastructure'],
  ['google', 'https://cloud.google.com/about/locations'],
  ['google cloud', 'https://cloud.google.com/about/locations'],
  ['equinix', 'https://www.equinix.com/data-centers'],
  ['alibaba cloud', 'https://www.alibabacloud.com/global-locations'],
  ['tencent', 'https://www.tencentcloud.com/products/regions'],
  ['tencent cloud', 'https://www.tencentcloud.com/products/regions'],
  ['yandex', 'https://cloud.yandex.com/en/regions'],
]);

function normalizeOperatorKey(operator) {
  return String(operator ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isSafeExternalHttpUrl(url) {
  const t = String(url ?? '').trim();
  if (!t || /\s/.test(t)) return false;
  if (!t.startsWith('http://') && !t.startsWith('https://')) return false;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeHttpUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (isSafeExternalHttpUrl(value)) return value;
  let stripped = value;
  while (/[)\].,;:!?]$/.test(stripped)) {
    stripped = stripped.slice(0, -1).trimEnd();
    if (isSafeExternalHttpUrl(stripped)) return stripped;
  }
  return null;
}

export function wikipediaSearchUrl(query) {
  const q = String(query ?? '').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  return `${WIKIPEDIA_SEARCH_PREFIX}${encodeURIComponent(q)}`;
}

/** Composite Wikipedia query for a specific facility (name + operator + geography). */
export function wikipediaSearchUrlDetailed(name, operator, country) {
  const parts = [name, operator, country]
    .map((s) => String(s ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!parts.length) return null;
  return wikipediaSearchUrl(parts.join(' '));
}

export function metadataSourceUrl(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const m = metadata;
  return (
    sanitizeHttpUrl(m.officialUrl) ??
    sanitizeHttpUrl(m.projectUrl) ??
    sanitizeHttpUrl(m.url) ??
    null
  );
}

const AWS_REGIONS_DOC =
  'https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html';

/**
 * When the element name contains an AWS region id (e.g. eu-west-1), link to the official
 * regions reference (the old aws.amazon.com/regions_az/... paths 404).
 */
export function awsRegionSourceUrl(name) {
  const m = String(name ?? '').match(/\b([a-z]{2}-[a-z]+-\d)\b/i);
  if (!m) return null;
  return AWS_REGIONS_DOC;
}

function operatorOfficialSourceUrl(operator) {
  const key = normalizeOperatorKey(operator);
  if (!key) return null;
  return OPERATOR_OFFICIAL_URLS.get(key) ?? null;
}

/** True if url is exactly one of the generic operator landing pages above. */
export function isOperatorGenericLandingUrl(url) {
  const u = String(url ?? '').trim();
  if (!u) return false;
  for (const v of OPERATOR_OFFICIAL_URLS.values()) {
    if (u === v) return true;
  }
  return false;
}

export function resolveProviderSourceUrl({ operator, metadata } = {}) {
  return (
    metadataSourceUrl(metadata) ??
    operatorOfficialSourceUrl(operator) ??
    wikipediaSearchUrl(operator) ??
    null
  );
}

function metadataCountry(metadata, explicitCountry) {
  if (explicitCountry != null && String(explicitCountry).trim()) return String(explicitCountry).trim();
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const c = metadata.country;
  return typeof c === 'string' && c.trim() ? c.trim() : null;
}

function providerUrlPreferringSpecific(providerSourceUrl) {
  const u = sanitizeHttpUrl(providerSourceUrl);
  if (!u) return null;
  if (isOperatorGenericLandingUrl(u)) return null;
  return u;
}

/**
 * Priority: explicit metadata URL → AWS region doc (when name matches) → non-generic provider URL
 * → Wikipedia (detailed) → generic operator landing → any provider URL → Wikipedia (name/operator).
 */
export function resolveServerSourceUrl({ name, operator, metadata, providerSourceUrl, country } = {}) {
  const metaCountry = metadataCountry(metadata, country);
  return (
    metadataSourceUrl(metadata) ??
    awsRegionSourceUrl(name) ??
    providerUrlPreferringSpecific(providerSourceUrl) ??
    wikipediaSearchUrlDetailed(name, operator, metaCountry) ??
    operatorOfficialSourceUrl(operator) ??
    sanitizeHttpUrl(providerSourceUrl) ??
    wikipediaSearchUrl(name) ??
    wikipediaSearchUrl(operator) ??
    null
  );
}

export function isWikipediaLikeUrl(url) {
  const s = String(url ?? '').toLowerCase();
  return s.includes('wikipedia.org');
}

export function isSafeExternalHttpUrlNormalized(url) {
  return isSafeExternalHttpUrl(url);
}
