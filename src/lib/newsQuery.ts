import type { Prisma } from '@prisma/client';

/** Шаги расширения окна «последние N дней», если записей мало. */
const DAY_STEPS = [3, 7, 14, 30, 90, 365] as const;

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function cutoffFromDays(days: number, now: Date): Date {
  const start = startOfDayUtc(now);
  return new Date(start.getTime() - days * 86400000);
}

/** Записи в окне: дата публикации >= cutoff ИЛИ дата неизвестна (null). */
export function newsTimeWhere(cutoff: Date): Prisma.NewsCacheWhereInput {
  return {
    OR: [{ publishedAt: { gte: cutoff } }, { publishedAt: null }],
  };
}

function daySequence(initialDays: number): number[] {
  const merged = new Set<number>([initialDays, ...DAY_STEPS]);
  return [...merged].sort((a, b) => a - b);
}

/**
 * Минимальное окно по дням, чтобы в кэше было достаточно строк для offset+pageSize
 * (иначе расширяем до полной ленты).
 */
export async function resolveNewsWindowDays(args: {
  prisma: {
    newsCache: {
      count: (args: { where?: Prisma.NewsCacheWhereInput }) => Promise<number>;
    };
  };
  offset: number;
  pageSize: number;
  initialDays?: number;
  now?: Date;
}): Promise<{ days: number | null; where: Prisma.NewsCacheWhereInput }> {
  const now = args.now ?? new Date();
  const initial = Math.max(1, Math.min(args.initialDays ?? 3, 3650));
  const need = args.offset + args.pageSize;

  for (const days of daySequence(initial)) {
    const cutoff = cutoffFromDays(days, now);
    const where = newsTimeWhere(cutoff);
    const cnt = await args.prisma.newsCache.count({ where });
    if (cnt >= need) {
      return { days, where };
    }
  }

  return { days: null, where: {} };
}

export const newsListOrderBy: Prisma.NewsCacheOrderByWithRelationInput[] = [
  { publishedAt: { sort: 'desc', nulls: 'last' } },
  { id: 'desc' },
];
