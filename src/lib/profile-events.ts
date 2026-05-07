/**
 * Событие обновления профиля (например, после смены никнейма).
 * Используется, чтобы компоненты-потребители (шапка сайта, хуки)
 * могли перечитать данные `/api/profile` без ручной перезагрузки страницы.
 */

export const PROFILE_UPDATED_EVENT = 'profile:updated';

export type ProfileUpdatedDetail = {
  pubkey: string;
  username?: string | null;
};

export function emitProfileUpdated(detail: ProfileUpdatedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ProfileUpdatedDetail>(PROFILE_UPDATED_EVENT, { detail }));
}
