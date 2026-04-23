// types.ts — прикладная библиотека/утилиты.

export type Scope = 'GLOBAL' | 'LOCAL';

export type NetworkElementType =
  | 'CABLE_COPPER'
  | 'CABLE_FIBER'

  // Node types (network elements)
  | 'PROVIDER'
  | 'SERVER'
  | 'SWITCH'
  | 'MULTIPLEXER'
  | 'DEMULTIPLEXER'
  | 'REGENERATOR'
  | 'REGENERATION_POINT'
  | 'MODEM'

  // Underground / terrestrial cables
  | 'CABLE_UNDERGROUND_COPPER'
  | 'CABLE_UNDERGROUND_FIBER'

  | 'BASE_STATION'
  | 'SATELLITE'
  | 'SATELLITE_RASSVET'
  | 'EQUIPMENT'
  | 'MESH_RELAY'
  | 'SMS_GATEWAY'
  | 'VSAT_TERMINAL'
  | 'OFFLINE_QUEUE';

export type LatLng = { lat: number; lng: number };

export type NetworkProviderDTO = {
  id: string;
  name: string;
  scope: Scope;
  sourceUrl?: string | null;
};

export type NetworkElementDTO = {
  id: string;
  scope: Scope;
  type: NetworkElementType;
  providerId?: string | null;
  name?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  altitude?: number | null;
  path?: LatLng[] | null;
  metadata?: Record<string, unknown> | null;
};

export type NetworkResponseDTO = {
  providers: NetworkProviderDTO[];
  elements: NetworkElementDTO[];
};

