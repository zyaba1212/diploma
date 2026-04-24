import { AuditAction } from '@/lib/audit';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Коротко показать длинный pubkey кошелька */
export function shortenPubkey(pubkey: string | null | undefined): string {
  if (!pubkey) return '—';
  if (pubkey.length <= 14) return pubkey;
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

const ROLE_RU: Record<string, string> = {
  ADMIN: 'администратор',
  MODERATOR: 'модератор',
};

const ACTION_LABEL_RU: Record<string, string> = {
  [AuditAction.StaffSessionRevoke]: 'Завершена одна чужая админ-сессия',
  [AuditAction.StaffSessionRevokeAll]: 'Завершены все чужие админ-сессии (кроме текущей)',
  [AuditAction.ModeratorAssign]: 'Назначен модератор',
  [AuditAction.ModeratorRevoke]: 'Сняты права модератора',
  [AuditAction.UserBan]: 'Пользователь заблокирован',
  [AuditAction.UserUnban]: 'Блокировка снята',
  [AuditAction.ProposalPin]: 'Предложение закреплено',
  [AuditAction.ProposalUnpin]: 'Закрепление снято',
  [AuditAction.ProposalForceCancel]: 'Предложение принудительно отменено',
  [AuditAction.ProposalForceRollback]: 'Откат изменений по предложению',
  [AuditAction.ProposalAdminHardDelete]: 'Предложение удалено из базы',
  [AuditAction.ProposalModerationDecision]: 'Решение по модерации предложения',
  'news.sync': 'Обновлена лента новостей (RSS → кэш)',
};

const TARGET_TYPE_RU: Record<string, string> = {
  StaffSession: 'Админ-сессия',
  Proposal: 'Предложение',
  User: 'Пользователь',
  NewsCache: 'Кэш новостей',
};

export function formatAuditTargetType(targetType: string | null): string {
  if (!targetType) return '—';
  return TARGET_TYPE_RU[targetType] ?? targetType;
}

export function formatAuditAction(action: string): string {
  return ACTION_LABEL_RU[action] ?? action;
}

export function formatAuditTarget(targetType: string | null, targetId: string | null): string {
  if (!targetType && !targetId) return '—';
  const typeRu = targetType ? formatAuditTargetType(targetType) : '';
  if (targetId) {
    const shortId = targetId.length > 12 ? `${targetId.slice(0, 10)}…` : targetId;
    return typeRu ? `${typeRu}, id ${shortId}` : shortId;
  }
  return typeRu || '—';
}

/**
 * Человекочитаемое описание поля meta для таблицы аудита.
 */
export function formatAuditMetaHuman(action: string, meta: unknown): string {
  if (meta == null) return '—';
  if (!isRecord(meta)) {
    return typeof meta === 'string' ? meta : JSON.stringify(meta);
  }

  const title = str(meta.title);
  const pubkey = str(meta.pubkey);
  const username = str(meta.username);
  const role = str(meta.role);
  const fetched = num(meta.fetched);
  const removed = num(meta.removed);
  const reason = str(meta.reason);
  const fromStatus = str(meta.fromStatus);
  const formerStatus = str(meta.formerStatus);
  const toStatus = str(meta.toStatus);
  const comment = str(meta.comment);
  const rejectionReason = str(meta.rejectionReason);
  const error = str(meta.error);
  const authorPubkey = str(meta.authorPubkey);
  const rolledBackHistoryId = str(meta.rolledBackHistoryId);
  const diffKind = str(meta.diffKind);

  if (action === AuditAction.StaffSessionRevoke && (role !== null || 'pubkey' in meta)) {
    const roleHuman = role ? ROLE_RU[role] ?? role.toLowerCase() : 'неизвестная роль';
    const wallet =
      pubkey === null || pubkey === undefined
        ? 'вход по паролю, кошелёк не указан'
        : pubkey === ''
          ? 'кошелёк не указан'
          : `кошелёк ${shortenPubkey(pubkey)}`;
    return `У завершённой сессии была роль «${roleHuman}». ${wallet.charAt(0).toUpperCase()}${wallet.slice(1)}.`;
  }

  if (action === AuditAction.StaffSessionRevokeAll && removed !== null) {
    return `Закрыто чужих сессий: ${removed}.`;
  }

  if (action === 'news.sync' || (fetched !== null && Object.keys(meta).length === 1 && 'fetched' in meta)) {
    if (fetched !== null) {
      return `В кэш новостей записано или обновлено записей: ${fetched}.`;
    }
  }

  if (action === AuditAction.ModeratorAssign && (pubkey || username)) {
    const u = username ? `@${username}` : 'пользователь';
    const pk = pubkey ? `, кошелёк ${shortenPubkey(pubkey)}` : '';
    return `${u}${pk}.`;
  }

  if (action === AuditAction.ModeratorRevoke && (pubkey || username)) {
    const u = username ? `@${username}` : 'пользователь';
    const pk = pubkey ? `, кошелёк ${shortenPubkey(pubkey)}` : '';
    return `Снята роль модератора: ${u}${pk}.`;
  }

  if (action === AuditAction.UserBan) {
    const parts: string[] = [];
    if (username) parts.push(`@${username}`);
    if (pubkey) parts.push(`кошелёк ${shortenPubkey(pubkey)}`);
    const who = parts.length ? parts.join(', ') : 'пользователь';
    const r = reason ? ` Причина: ${reason}` : '';
    return `Заблокирован: ${who}.${r}`;
  }

  if (action === AuditAction.UserUnban) {
    const parts: string[] = [];
    if (username) parts.push(`@${username}`);
    if (pubkey) parts.push(`кошелёк ${shortenPubkey(pubkey)}`);
    const who = parts.length ? parts.join(', ') : 'пользователь';
    return `Снята блокировка: ${who}.`;
  }

  if (action === AuditAction.ProposalPin || action === AuditAction.ProposalUnpin) {
    return title ? `Название: «${title}».` : '—';
  }

  if (action === AuditAction.ProposalForceCancel) {
    const parts: string[] = [];
    if (title) parts.push(`«${title}»`);
    if (fromStatus) parts.push(`был статус: ${fromStatus}`);
    if (reason) parts.push(`причина: ${reason}`);
    return parts.length ? parts.join('. ') + '.' : '—';
  }

  if (action === AuditAction.ProposalForceRollback) {
    const parts: string[] = [];
    if (title) parts.push(`Предложение «${title}»`);
    if (diffKind) parts.push(`откат шага: ${diffKind}`);
    if (rolledBackHistoryId) parts.push(`запись истории ${rolledBackHistoryId.slice(0, 10)}…`);
    if (reason) parts.push(`комментарий: ${reason}`);
    if (error) parts.push(`ошибка: ${error}`);
    return parts.length ? parts.join('. ') + '.' : '—';
  }

  if (action === AuditAction.ProposalAdminHardDelete) {
    const parts: string[] = [];
    if (title) parts.push(`«${title}»`);
    if (formerStatus) parts.push(`статус до удаления: ${formerStatus}`);
    if (authorPubkey) parts.push(`автор: ${shortenPubkey(authorPubkey)}`);
    if (reason) parts.push(`комментарий: ${reason}`);
    return parts.length ? parts.join('. ') + '.' : '—';
  }

  if (action === AuditAction.ProposalModerationDecision) {
    const parts: string[] = [];
    if (toStatus) parts.push(`новый статус: ${toStatus}`);
    if (comment) parts.push(`комментарий: ${comment}`);
    if (rejectionReason) parts.push(`причина отказа: ${rejectionReason}`);
    return parts.length ? parts.join('. ') + '.' : '—';
  }

  return formatMetaFallback(meta);
}

const META_KEY_RU: Record<string, string> = {
  role: 'роль',
  pubkey: 'кошелёк',
  username: 'имя',
  title: 'название',
  reason: 'причина',
  fetched: 'записей в кэше',
  removed: 'закрыто сессий',
  fromStatus: 'был статус',
  formerStatus: 'статус до удаления',
  toStatus: 'статус',
  comment: 'комментарий',
  rejectionReason: 'причина отказа',
  error: 'ошибка',
  authorPubkey: 'автор (кошелёк)',
  rolledBackHistoryId: 'запись истории',
  diffKind: 'тип отката',
};

function formatMetaFallback(meta: Record<string, unknown>): string {
  const entries = Object.entries(meta).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '—';
  return entries
    .map(([k, v]) => {
      const label = META_KEY_RU[k] ?? k;
      if (v === null) return `${label}: нет`;
      if (typeof v === 'string') {
        if (k.toLowerCase().includes('pubkey')) return `${label}: ${shortenPubkey(v)}`;
        return `${label}: ${v}`;
      }
      if (typeof v === 'number' || typeof v === 'boolean') return `${label}: ${String(v)}`;
      return `${label}: ${JSON.stringify(v)}`;
    })
    .join('. ')
    .concat('.');
}
