/**
 * Определение сценария по метаданным элементов графа (после foldProposalActionsForDisplay).
 * Должно совпадать со значением `metadata.scenario` в сиде digital-ruble-offline-minsk.
 */

export const DIGITAL_RUBLE_OFFLINE_MINSK_SCENARIO = 'digital-ruble-offline-minsk';

export function isDigitalRubleMinskScenario(elements: Record<string, unknown>[]): boolean {
  for (const el of elements) {
    const m = el.metadata;
    if (typeof m !== 'object' || m === null || Array.isArray(m)) continue;
    const scenario = (m as Record<string, unknown>).scenario;
    if (scenario === DIGITAL_RUBLE_OFFLINE_MINSK_SCENARIO) return true;
  }
  return false;
}
