/**
 * Реестр deep backfill: sitemap-цепочки и паттерны URL по каждому источнику из NEWS_RSS_SOURCES.
 * API-каналы не используются (требуют ключи/ToS); при недоступности sitemap источник пропускается с логом.
 */

export type DeepSourceStrategy = {
  /** Имя как в NEWS_RSS_SOURCES[].name */
  sourceName: string;
  /** Порядок попыток загрузки sitemap (index или urlset). */
  sitemapUrls: string[];
  /** Хотя бы один regex должен совпасть с pathname (после lower). */
  urlPathPatterns: RegExp[];
  /** Если задано — hostname URL должен входить в список (без порта). */
  allowedHosts?: string[];
  /** Ограничение числа дочерних sitemap при разборе index (защита). */
  maxChildSitemaps?: number;
  /** Заметки для ops (ограничения архива, риски). */
  notes?: string;
};

/**
 * Паттерны и URL носят эвристический характер: сайты меняют sitemap.
 * При сбое конкретного URL engine пробует следующий в sitemapUrls.
 */
export const DEEP_NEWS_SOURCE_STRATEGIES: DeepSourceStrategy[] = [
  {
    sourceName: 'Habr Telecom',
    sitemapUrls: ['https://habr.com/ru/sitemap.xml', 'https://habr.com/sitemap.xml'],
    urlPathPatterns: [/\/hub\/telecom\//i, /\/ru\/post\//i],
    allowedHosts: ['habr.com'],
    maxChildSitemaps: 30,
    notes: 'В sitemap попадают все посты; релевантность добирается фильтром текста после загрузки title.',
  },
  {
    sourceName: 'CNews',
    sitemapUrls: ['https://www.cnews.ru/sitemap.xml', 'https://www.cnews.ru/sitemap_index.xml'],
    urlPathPatterns: [/\/news\//i, /\/articles?\//i],
    allowedHosts: ['www.cnews.ru', 'cnews.ru'],
    maxChildSitemaps: 25,
  },
  {
    sourceName: 'Ars Technica',
    sitemapUrls: [
      'https://arstechnica.com/news-sitemap.xml',
      'https://arstechnica.com/sitemap.xml',
      'https://arstechnica.com/ars-sitemap.xml',
    ],
    urlPathPatterns: [/\/\d{4}\/\d{2}\//i, /\/science\//i, /\/tech-policy\//i, /\/information-technology\//i],
    allowedHosts: ['arstechnica.com'],
    maxChildSitemaps: 20,
  },
  {
    sourceName: '3DNews',
    sitemapUrls: ['https://3dnews.ru/sitemap.xml', 'https://3dnews.ru/news/sitemap.xml'],
    urlPathPatterns: [/\/news\//i],
    allowedHosts: ['3dnews.ru', 'www.3dnews.ru'],
    maxChildSitemaps: 25,
  },
  {
    sourceName: 'SecurityLab',
    sitemapUrls: ['https://www.securitylab.ru/sitemap.xml'],
    urlPathPatterns: [/\/news\//i, /\/blog\//i],
    allowedHosts: ['www.securitylab.ru', 'securitylab.ru'],
    maxChildSitemaps: 20,
  },
  {
    sourceName: 'ComNews',
    sitemapUrls: ['https://www.comnews.ru/sitemap.xml', 'https://www.comnews.ru/sitemap_index.xml'],
    urlPathPatterns: [/\/content\/\d+/i, /\/news\//i],
    allowedHosts: ['www.comnews.ru', 'comnews.ru'],
    maxChildSitemaps: 20,
  },
  {
    sourceName: 'IXBT',
    sitemapUrls: [
      'https://www.ixbt.com/sitemap.xml',
      'https://ixbt.com/sitemap.xml',
      'https://www.ixbt.com/export/sitemap.xml',
      'https://www.ixbt.com/news/sitemap.xml',
    ],
    urlPathPatterns: [/\/news\//i],
    allowedHosts: ['www.ixbt.com', 'ixbt.com'],
    maxChildSitemaps: 25,
  },
  {
    sourceName: 'RBC Tech',
    sitemapUrls: ['https://www.rbc.ru/sitemap.xml', 'https://www.rbc.ru/sitemap_index.xml'],
    urlPathPatterns: [/\/technology_and_media\//i, /\/technology\//i, /\/biz\/\d+\/\d+\/\d+\//i],
    allowedHosts: ['www.rbc.ru', 'rbc.ru'],
    maxChildSitemaps: 15,
    notes: 'Общий sitemap RBC большой; отбор по path + релевантность текста.',
  },
  {
    sourceName: 'The Verge',
    sitemapUrls: [
      'https://www.theverge.com/sitemap.xml',
      'https://www.theverge.com/sitemaps/sitemap.xml',
      'https://www.theverge.com/google-news-sitemap.xml',
    ],
    urlPathPatterns: [/\/\d{4}\/\d{1,2}\/\d{1,2}\//i, /\/[^/]+\/\d{4}\/\d{1,2}\/\d{1,2}\//i],
    allowedHosts: ['www.theverge.com', 'theverge.com'],
    maxChildSitemaps: 25,
  },
  {
    sourceName: 'Wired',
    sitemapUrls: ['https://www.wired.com/sitemap.xml', 'https://www.wired.com/feed/sitemap'],
    urlPathPatterns: [/\/story\//i, /\/article\//i, /\/\d{4}\/\d{2}\//i],
    allowedHosts: ['www.wired.com', 'wired.com'],
    maxChildSitemaps: 25,
  },
  {
    sourceName: 'TechCrunch',
    sitemapUrls: ['https://techcrunch.com/sitemap.xml', 'https://techcrunch.com/news-sitemap.xml'],
    urlPathPatterns: [/\/\d{4}\/\d{2}\/\d{2}\//i],
    allowedHosts: ['techcrunch.com', 'www.techcrunch.com'],
    maxChildSitemaps: 25,
  },
];

export function getDeepStrategyBySourceName(name: string): DeepSourceStrategy | undefined {
  return DEEP_NEWS_SOURCE_STRATEGIES.find((s) => s.sourceName === name);
}
