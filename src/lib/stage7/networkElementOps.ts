// stage7/networkElementOps.ts — прикладная библиотека/утилиты.

import type { Scope, NetworkElementType } from '@prisma/client';

export type NetworkElementSnapshot = {
  id: string;
  scope: Scope;
  type: NetworkElementType;
  providerId: string | null;
  name: string | null;
  sourceId: string | null;
  lat: number | null;
  lng: number | null;
  altitude: number | null;
  path: unknown | null;
  metadata: unknown | null;
};

// Keep as `string[]` to avoid build-time coupling to the currently generated
// `@prisma/client` enum union during schema migrations (prisma generate may fail).
const NETWORK_ELEMENT_TYPES: string[] = [
  'CABLE_COPPER',
  'CABLE_FIBER',

  // Node types
  'SERVER',
  'SWITCH',
  'MULTIPLEXER',
  'DEMULTIPLEXER',
  'REGENERATOR',
  'REGENERATION_POINT',
  'MODEM',

  // Underground / terrestrial cables
  'CABLE_UNDERGROUND_COPPER',
  'CABLE_UNDERGROUND_FIBER',

  'BASE_STATION',
  'SATELLITE',
  'SATELLITE_RASSVET',
  'EQUIPMENT',
  'MESH_RELAY',
  'SMS_GATEWAY',
  'VSAT_TERMINAL',
  'OFFLINE_QUEUE',
];

export function isNetworkElementType(value: unknown): value is NetworkElementType {
  return typeof value === 'string' && NETWORK_ELEMENT_TYPES.includes(value);
}

function optString(value: unknown): string | null | undefined {
  if (typeof value === 'string') return value;
  if (value === null) return null;
  return undefined;
}

function optNumber(value: unknown): number | null | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  if (value === null) return null;
  return undefined;
}

function optJson(value: unknown): unknown | null | undefined {
  if (value === null) return null;
  if (typeof value === 'object') return value;
  return undefined;
}

export function snapshotFromNetworkElement(el: {
  id: string;
  scope: Scope;
  type: NetworkElementType;
  providerId: string | null;
  name: string | null;
  sourceId: string | null;
  lat: number | null;
  lng: number | null;
  altitude: number | null;
  path: unknown | null;
  metadata: unknown | null;
}): NetworkElementSnapshot {
  return { ...el };
}

export function buildNetworkElementCreateData(params: {
  proposalScope: Scope;
  payload: any;
}): Omit<NetworkElementSnapshot, 'id'> & { id?: string } {
  const payload = params.payload ?? {};
  const type = payload.type;
  if (!isNetworkElementType(type)) {
    throw new Error('elementPayload.type must be a valid NetworkElementType');
  }

  const providerId = optString(payload.providerId) ?? null;
  const name = optString(payload.name) ?? null;
  const sourceId = optString(payload.sourceId) ?? null;

  const lat = optNumber(payload.lat) ?? null;
  const lng = optNumber(payload.lng) ?? null;
  const altitude = optNumber(payload.altitude) ?? null;

  const path = optJson(payload.path) ?? null;
  const metadata = optJson(payload.metadata) ?? null;

  return {
    scope: params.proposalScope,
    type,
    providerId,
    name,
    sourceId,
    lat,
    lng,
    altitude,
    path,
    metadata,
  };
}

export function buildNetworkElementUpdateData(payload: any): Partial<{
  type: NetworkElementType;
  providerId: string | null;
  name: string | null;
  sourceId: string | null;
  lat: number | null;
  lng: number | null;
  altitude: number | null;
  path: unknown | null;
  metadata: unknown | null;
}> {
  const data: any = {};
  if (payload && typeof payload === 'object') {
    if (isNetworkElementType(payload.type)) data.type = payload.type;
    const providerId = optString(payload.providerId);
    if (typeof providerId !== 'undefined') data.providerId = providerId;
    const name = optString(payload.name);
    if (typeof name !== 'undefined') data.name = name;
    const sourceId = optString(payload.sourceId);
    if (typeof sourceId !== 'undefined') data.sourceId = sourceId;

    const lat = optNumber(payload.lat);
    if (typeof lat !== 'undefined') data.lat = lat;
    const lng = optNumber(payload.lng);
    if (typeof lng !== 'undefined') data.lng = lng;
    const altitude = optNumber(payload.altitude);
    if (typeof altitude !== 'undefined') data.altitude = altitude;

    const path = optJson(payload.path);
    if (typeof path !== 'undefined') data.path = path;
    const metadata = optJson(payload.metadata);
    if (typeof metadata !== 'undefined') data.metadata = metadata;
  }
  return data;
}

