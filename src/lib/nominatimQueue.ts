/**
 * Сериализация запросов к Nominatim (~1 req/s по политике OSM) в рамках одного процесса Node.
 */

const MIN_INTERVAL_MS = 1100;

let mutex = Promise.resolve<void>(undefined);
let isFirst = true;

export function enqueueNominatimFetch<T>(fn: () => Promise<T>): Promise<T> {
  const p = mutex.then(async () => {
    if (!isFirst) {
      await new Promise<void>((r) => setTimeout(r, MIN_INTERVAL_MS));
    }
    isFirst = false;
    return fn();
  });
  mutex = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}
