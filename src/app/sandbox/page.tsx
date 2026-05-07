'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as THREE from 'three';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { useAuthorPubkey } from '@/hooks/useAuthorPubkey';
import { useSessionVerified } from '@/hooks/useSessionVerified';
import { EQUIPMENT_FACTORIES, NODE_VISUALS, CABLE_COLORS, createSatelliteObject } from '@/lib/three/factories';
import { latLngToVec3, orientGlobeGroupCenterFromLatLng, computeGlobeCenterLatLng, makeTextMesh, disposeThreeObject } from '@/lib/three/utils';
import { attachGlobeTrackballControls } from '@/lib/three/globeTrackballControls';
import { applyGlobeZoomDelta } from '@/lib/three/globeZoom';
import { WORLD_LABELS } from '@/lib/three/labels';
import { getEarthMaterialMode, getEarthSphereSegments } from '@/lib/earthQuality';
import { disposeEarthTextures, loadEarthTextures } from '@/lib/loadEarthTextures';
import { buildProposalNodeDivIcon } from '@/lib/leaflet/proposalNodeIcons';
import {
  readSandboxDraftFromStorage,
  writeSandboxDraftToStorage,
  SANDBOX_DRAFT_VERSION,
  type SandboxDraftV1,
} from '@/lib/sandbox/sandboxDraft';
import { proposalActionsToSandboxElementsFolded } from '@/lib/sandbox/foldedDisplayToSandboxElements';
import { sandboxElementsToCreatePayloads } from '@/lib/sandbox/sandboxElementsToCreates';
import { generateNextAutoName } from '@/lib/sandbox/autoName';
import {
  canCommitProposalGraphRevision,
  canInteractEditSandboxProposal,
} from '@/lib/stage7/proposalMutationPolicy';
import { usernameIsPinnedNetworkCurator } from '@/lib/pinnedNetworkCurator';
import type { ProposalStatus } from '@prisma/client';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { colors } from '@/theme/colors';
import {
  NETWORK_LEGEND_GROUPS,
  SANDBOX_LEGEND_SHORT_LABEL,
  getLegendItem,
} from '@/lib/networkLegend/registry';
import { NetworkLegendLineSample, NetworkLegendNodeIcon } from '@/lib/networkLegend/render';

import type L from 'leaflet';

/** Runtime/default-export Leaflet namespace shape (markers, lines). */
type LeafletLib = typeof L;

type ElementType =
  | 'SERVER' | 'SWITCH' | 'MULTIPLEXER' | 'DEMULTIPLEXER' | 'BASE_STATION'
  | 'REGENERATOR' | 'SATELLITE' | 'SATELLITE_RASSVET' | 'MESH_RELAY' | 'SMS_GATEWAY'
  | 'VSAT_TERMINAL'
  | 'CABLE_UNDERGROUND_FIBER' | 'CABLE_UNDERGROUND_COPPER' | 'CABLE_FIBER' | 'CABLE_COPPER';

const MAP_ZOOM_MIN = 2;
const MAP_ZOOM_MAX = 18;
const GLOBE_Z_MIN = 1.2;
const GLOBE_Z_MAX = 6;
const GLOBE_Z_STEP = 0.25;

type SandboxElement = {
  tempId: string;
  type: ElementType;
  /** Авто-генерируемое короткое имя по типу (`switch1`, `switch2`, ...). */
  name: string;
  /** Пользовательская подпись (опционально). Полное имя в UI: `name (caption || name)`. */
  caption?: string;
  lat: number;
  lng: number;
  fromId?: string;
  toId?: string;
};

type ViewMode = 'MAP_2D' | 'GLOBE_3D';

type SearchResult = { lat: string; lon: string; display_name?: string };

type MyProposalRow = {
  id: string;
  title: string | null;
  status: string;
  onChainTxSignature: string | null;
  _count?: { votes: number };
};

function hasMeaningfulDraft(draft: SandboxDraftV1 | null): draft is SandboxDraftV1 {
  return Boolean(draft && (draft.elements?.length ?? 0) > 0);
}

function canCommitSandboxGraphInPlaceFromMeta(meta: {
  status: string;
  voteCount: number;
  onChainTxSignature: string | null;
  commitSandboxGraphInPlace?: boolean;
}): boolean {
  if (meta.commitSandboxGraphInPlace === true) return true;
  return canCommitProposalGraphRevision({
    status: meta.status as ProposalStatus,
    voteCount: meta.voteCount,
    onChainTxSignature: meta.onChainTxSignature,
  });
}

function parseIsoMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Группы для левой панели sandbox получаем из единого реестра легенды (`NETWORK_LEGEND_GROUPS`),
 * фильтруя интерактивные типы (`isElementType`) и применяя короткие подписи (`SANDBOX_LEGEND_SHORT_LABEL`).
 * Это устраняет дрейф цветов/подписей между sandbox и картой/легендой.
 */
const SANDBOX_CATEGORY_TITLES: Record<'equipment' | 'offline' | 'cables', string> = {
  equipment: 'Оборудование',
  offline: 'Офлайн-инфраструктура',
  cables: 'Кабели',
};

const ELEMENT_TYPES: { category: string; types: { type: ElementType; label: string; color: string }[] }[] = (() => {
  const out: { category: string; types: { type: ElementType; label: string; color: string }[] }[] = [];
  for (const g of NETWORK_LEGEND_GROUPS) {
    if (g.id === 'logical') continue;
    const interactive = g.items.filter((i) => i.isElementType);
    if (interactive.length === 0) continue;
    out.push({
      category: SANDBOX_CATEGORY_TITLES[g.id as 'equipment' | 'offline' | 'cables'] ?? g.title,
      types: interactive.map((i) => ({
        type: i.type as ElementType,
        label: SANDBOX_LEGEND_SHORT_LABEL[i.type] ?? i.label,
        color: i.color,
      })),
    });
  }
  return out;
})();

const CABLE_TYPES = new Set(['CABLE_UNDERGROUND_FIBER', 'CABLE_UNDERGROUND_COPPER', 'CABLE_FIBER', 'CABLE_COPPER']);
function isCable(type: string) { return CABLE_TYPES.has(type); }

let idCounter = 0;
function tempId() { return `sb-${++idCounter}-${Date.now()}`; }

function nodeColor(type: string): string {
  const v = NODE_VISUALS[type];
  if (!v) return '#ff9900';
  return '#' + v.color.toString(16).padStart(6, '0');
}

/** Полное человекочитаемое имя элемента: `name (caption || name)`. */
function elementDisplayName(el: { name?: string | null; caption?: string | null; type: string }): string {
  const base = (el.name && el.name.trim()) ? el.name : el.type;
  const cap = el.caption?.trim();
  return cap ? `${base} (${cap})` : `${base} (${base})`;
}

function createLayeredCableLayer(
  leaflet: typeof L,
  points: [number, number][],
  color: string,
  isDashed: boolean,
): L.LayerGroup {
  const g = leaflet.layerGroup();
  leaflet
    .polyline(points, {
      color: '#071120',
      weight: 6,
      opacity: 0.24,
      dashArray: isDashed ? '9,7' : undefined,
    })
    .addTo(g);
  leaflet
    .polyline(points, {
      color,
      weight: 3,
      opacity: 0.92,
      dashArray: isDashed ? '8,6' : undefined,
    })
    .addTo(g);
  return g;
}

type SandboxEditSnapshot = {
  elements: SandboxElement[];
  selectedType: ElementType | null;
  cableFromId: string | null;
};

function cloneSnapshot(s: SandboxEditSnapshot): SandboxEditSnapshot {
  return {
    elements: s.elements.map((el) => ({ ...el })),
    selectedType: s.selectedType,
    cableFromId: s.cableFromId,
  };
}

function snapshotsDeepEqual(a: SandboxEditSnapshot, b: SandboxEditSnapshot): boolean {
  if (a.selectedType !== b.selectedType || a.cableFromId !== b.cableFromId) return false;
  if (a.elements.length !== b.elements.length) return false;
  for (let i = 0; i < a.elements.length; i++) {
    const x = a.elements[i];
    const y = b.elements[i];
    if (
      x.tempId !== y.tempId ||
      x.type !== y.type ||
      x.name !== y.name ||
      (x.caption ?? '') !== (y.caption ?? '') ||
      x.lat !== y.lat ||
      x.lng !== y.lng ||
      x.fromId !== y.fromId ||
      x.toId !== y.toId
    ) {
      return false;
    }
  }
  return true;
}

function isTextInputShortcutTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export default function SandboxPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editProposalId = useMemo(() => {
    const raw = searchParams.get('proposalId')?.trim();
    return raw && raw.length > 0 ? raw : null;
  }, [searchParams]);

  const authorPubkey = useAuthorPubkey();
  const sessionVerified = useSessionVerified();
  const { connected, signMessage } = useWallet();

  const [editHistory, setEditHistory] = useState<{
    past: SandboxEditSnapshot[];
    present: SandboxEditSnapshot;
    future: SandboxEditSnapshot[];
  }>({
    past: [],
    present: { elements: [], selectedType: null, cableFromId: null },
    future: [],
  });

  const { elements, selectedType, cableFromId } = editHistory.present;

  const serverBaselineSnapshotRef = useRef<SandboxEditSnapshot | null>(null);
  /** Синхронизируется с `sandboxInteractionLocked` перед обработчиками ввода. */
  const readOnlyInteractionRef = useRef(false);

  const replaceEditBootstrap = useCallback((present: SandboxEditSnapshot) => {
    setEditHistory({
      past: [],
      present: cloneSnapshot(present),
      future: [],
    });
  }, []);

  const applyEditMutation = useCallback((updater: (prev: SandboxEditSnapshot) => SandboxEditSnapshot) => {
    if (readOnlyInteractionRef.current) return;
    setEditHistory((h) => {
      const next = updater(h.present);
      if (snapshotsDeepEqual(h.present, next)) return h;
      return {
        past: [...h.past, cloneSnapshot(h.present)],
        present: cloneSnapshot(next),
        future: [],
      };
    });
  }, []);

  const patchPresent = useCallback((partial: Partial<Pick<SandboxEditSnapshot, 'selectedType' | 'cableFromId'>>) => {
    if (readOnlyInteractionRef.current) return;
    setEditHistory((h) => ({
      ...h,
      present: { ...h.present, ...partial },
    }));
  }, []);

  const applyEditMutationRef = useRef(applyEditMutation);
  applyEditMutationRef.current = applyEditMutation;
  const patchPresentRef = useRef(patchPresent);
  patchPresentRef.current = patchPresent;

  const undo = useCallback(() => {
    if (readOnlyInteractionRef.current) return;
    setEditHistory((h) => {
      if (h.past.length === 0) return h;
      const prev = h.past[h.past.length - 1];
      return {
        past: h.past.slice(0, -1),
        present: cloneSnapshot(prev),
        future: [cloneSnapshot(h.present), ...h.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    if (readOnlyInteractionRef.current) return;
    setEditHistory((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0];
      return {
        past: [...h.past, cloneSnapshot(h.present)],
        present: cloneSnapshot(next),
        future: h.future.slice(1),
      };
    });
  }, []);

  /**
   * Возвращает сцену к "началу":
   * - Для proposal-режима — к серверному baseline (загруженному при открытии редактора).
   * - Для новой песочницы — к пустому графу (как при первой загрузке без черновика).
   * Действие undo-friendly: один шаг истории.
   */
  const jumpToInitialSnapshot = useCallback(() => {
    if (readOnlyInteractionRef.current) return;
    if (editProposalId) {
      const baseline = serverBaselineSnapshotRef.current;
      if (!baseline) return;
      applyEditMutation(() => cloneSnapshot(baseline));
    } else {
      applyEditMutation(() => ({ elements: [], selectedType: null, cableFromId: null }));
    }
  }, [applyEditMutation, editProposalId]);

  // --- SELECTION + BULK DELETE (declared early because referenced from sync effects below) ---
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const toggleSelection = useCallback((tid: string, additive: boolean) => {
    if (readOnlyInteractionRef.current) return;
    setSelectedIds((prev) => {
      if (!additive) {
        if (prev.size === 1 && prev.has(tid)) return new Set();
        return new Set([tid]);
      }
      const next = new Set(prev);
      if (next.has(tid)) next.delete(tid);
      else next.add(tid);
      return next;
    });
  }, []);

  const toggleSelectionRef = useRef(toggleSelection);
  toggleSelectionRef.current = toggleSelection;

  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  /**
   * Удаляет все выделенные элементы одной мутацией.
   * Каскад: если удаляется узел — удаляются и все связанные с ним кабели,
   * как в одиночном `removeElement`. Один шаг undo для пакетного удаления.
   */
  const removeSelectedElements = useCallback(() => {
    if (readOnlyInteractionRef.current) return;
    if (selectedIds.size === 0) return;
    applyEditMutation((prev) => {
      const idsToDelete = new Set<string>(selectedIds);
      for (const el of prev.elements) {
        if (!idsToDelete.has(el.tempId)) continue;
        if (isCable(el.type)) continue;
        for (const other of prev.elements) {
          if (
            isCable(other.type) &&
            (other.fromId === el.tempId || other.toId === el.tempId)
          ) {
            idsToDelete.add(other.tempId);
          }
        }
      }
      const nextElements = prev.elements.filter((e) => !idsToDelete.has(e.tempId));
      const nextCableFromId =
        prev.cableFromId && idsToDelete.has(prev.cableFromId) ? null : prev.cableFromId;
      return { ...prev, elements: nextElements, cableFromId: nextCableFromId };
    });
    setSelectedIds(new Set());
  }, [applyEditMutation, selectedIds]);

  const [viewMode, setViewMode] = useState<ViewMode>('MAP_2D');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [proposalTitle, setProposalTitle] = useState('');
  const [proposalDesc, setProposalDesc] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [headRevisionId, setHeadRevisionId] = useState<string | null>(null);
  const lastSyncedMetaRef = useRef({ title: '', description: '' });
  const [showSaveModal, setShowSaveModal] = useState(false);
  /** При редактировании существующего proposal: два взаимоисключающих сценария в модалке. */
  const [saveModalTab, setSaveModalTab] = useState<'updateCurrent' | 'forkAsNew'>('updateCurrent');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [mapZoom, setMapZoom] = useState(6);
  const [globeZ, setGlobeZ] = useState(3);
  const [mapReady, setMapReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /** Bumps when map center changes (moveend) so session draft can persist `savedCenterRef`. */
  const [mapCenterPersistNonce, setMapCenterPersistNonce] = useState(0);

  const [editProposalMeta, setEditProposalMeta] = useState<{
    id: string;
    status: string;
    voteCount: number;
    onChainTxSignature: string | null;
    /** С сервера: см. GET /api/proposals/:id capabilities (супер-редактирование закреплённой сети). */
    commitSandboxGraphInPlace?: boolean;
  } | null>(null);
  const [proposalLoadError, setProposalLoadError] = useState<string | null>(null);
  const draftRestoredForEditRef = useRef(false);
  const [myNetworks, setMyNetworks] = useState<MyProposalRow[]>([]);
  const [myNetworksLoading, setMyNetworksLoading] = useState(false);
  const [networkPickerOpen, setNetworkPickerOpen] = useState(false);
  const networkPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setSidebarOpen(!mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!networkPickerOpen) return;
    const onDocPointer = (e: MouseEvent | TouchEvent) => {
      const node = networkPickerRef.current;
      if (!node) return;
      const target = e.target as Node | null;
      if (target && !node.contains(target)) setNetworkPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNetworkPickerOpen(false);
    };
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('touchstart', onDocPointer, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('touchstart', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [networkPickerOpen]);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const threeContainerRef = useRef<HTMLDivElement>(null);
  const leafletLayersRef = useRef<Map<string, L.Layer>>(new Map());
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const selectedTypeRef = useRef(selectedType);
  selectedTypeRef.current = selectedType;
  const cableFromIdRef = useRef(cableFromId);
  cableFromIdRef.current = cableFromId;

  const savedCenterRef = useRef<{ lat: number; lng: number }>({ lat: 53.9, lng: 27.56 });
  /** After first layout pass — avoids overwriting session draft with empty state before restore runs. */
  const sandboxHydratedRef = useRef(false);

  // --- Session draft: restore before map init (layout) so first Leaflet instance uses saved zoom/center
  useLayoutEffect(() => {
    draftRestoredForEditRef.current = false;
    try {
      const d = readSandboxDraftFromStorage(editProposalId);

      if (editProposalId) {
        // For existing proposal editing, server snapshot wins by default.
        // Draft restore is decided later after proposal fetch with recency check.
        serverBaselineSnapshotRef.current = null;
        replaceEditBootstrap({ elements: [], selectedType: null, cableFromId: null });
      } else {
        serverBaselineSnapshotRef.current = null;
        if (d) {
          replaceEditBootstrap({
            elements: d.elements as SandboxElement[],
            selectedType: d.selectedType as ElementType | null,
            cableFromId: d.cableFromId,
          });
          setViewMode(d.viewMode);
          savedCenterRef.current = d.savedCenter;
          setMapZoom(d.mapZoom);
        } else {
          replaceEditBootstrap({ elements: [], selectedType: null, cableFromId: null });
        }
      }
    } finally {
      sandboxHydratedRef.current = true;
    }
  }, [editProposalId, replaceEditBootstrap]);

  // Список своих сетей для переключателя
  useEffect(() => {
    if (!authorPubkey) {
      setMyNetworks([]);
      return;
    }
    let cancelled = false;
    setMyNetworksLoading(true);
    const q =
      'authorPubkey=' +
      encodeURIComponent(authorPubkey) +
      '&status=DRAFT,SUBMITTED,ACCEPTED,APPLIED,WITHDRAWN,REJECTED,CANCELLED&limit=80';
    fetch(`/api/proposals?${q}`)
      .then(r => (r.ok ? r.json() : []))
      .then((rows: MyProposalRow[]) => {
        if (!cancelled && Array.isArray(rows)) setMyNetworks(rows);
      })
      .catch(() => {
        if (!cancelled) setMyNetworks([]);
      })
      .finally(() => {
        if (!cancelled) setMyNetworksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authorPubkey]);

  // Загрузка существующего предложения для редактирования (если нет непустого черновика вкладки).
  useEffect(() => {
    if (!editProposalId || !authorPubkey) {
      setEditProposalMeta(null);
      setProposalLoadError(null);
      serverBaselineSnapshotRef.current = null;
      return;
    }

    let cancelled = false;
    setProposalLoadError(null);
    serverBaselineSnapshotRef.current = null;

    (async () => {
      try {
        const r = await fetch(`/api/proposals/${encodeURIComponent(editProposalId)}`);
        if (!r.ok) {
          if (!cancelled) setProposalLoadError('Предложение не найдено.');
          return;
        }
        const p = (await r.json()) as {
          id: string;
          authorPubkey: string;
          status: string;
          updatedAt: string;
          title: string | null;
          description: string | null;
          onChainTxSignature: string | null;
          headRevisionId?: string | null;
          pinned?: boolean;
          capabilities?: { commitSandboxGraphInPlace?: boolean };
          actions: Array<{
            id: string;
            actionType: string;
            targetElementId?: string | null;
            elementPayload: Record<string, unknown>;
          }>;
          _count?: { votes: number };
        };

        const profileRes = await fetch(`/api/profile?pubkey=${encodeURIComponent(authorPubkey)}`);
        const profileJson = profileRes.ok
          ? ((await profileRes.json()) as { username?: string | null })
          : {};
        const mySiteUsername = profileJson.username ?? null;
        const curatorMayOpenPinned =
          Boolean(p.pinned) && usernameIsPinnedNetworkCurator(mySiteUsername);

        if (p.authorPubkey !== authorPubkey && !curatorMayOpenPinned) {
          if (!cancelled) setProposalLoadError('Это предложение принадлежит другому автору.');
          return;
        }

        const viewStatuses = ['DRAFT', 'SUBMITTED', 'ACCEPTED', 'APPLIED', 'WITHDRAWN', 'REJECTED', 'CANCELLED'];
        if (!viewStatuses.includes(p.status)) {
          if (!cancelled) {
            setProposalLoadError('Это предложение нельзя открыть в песочнице (статус не поддерживается).');
          }
          return;
        }

        const voteCount = typeof p._count?.votes === 'number' ? p._count.votes : 0;
        const onChain = p.onChainTxSignature ?? null;
        if (!cancelled) {
          setEditProposalMeta({
            id: p.id,
            status: p.status,
            voteCount,
            onChainTxSignature: onChain,
            commitSandboxGraphInPlace:
              typeof p.capabilities?.commitSandboxGraphInPlace === 'boolean'
                ? p.capabilities.commitSandboxGraphInPlace
                : undefined,
          });
          setProposalTitle(p.title || '');
          setProposalDesc(p.description || '');
          setHeadRevisionId(typeof p.headRevisionId === 'string' ? p.headRevisionId : null);
          lastSyncedMetaRef.current = {
            title: (p.title || '').trim(),
            description: (p.description || '').trim(),
          };

          const imported = proposalActionsToSandboxElementsFolded(
            (p.actions ?? []).map((a) => ({
              id: a.id,
              actionType: a.actionType,
              targetElementId: a.targetElementId,
              elementPayload: a.elementPayload,
            })),
          ) as SandboxElement[];

          serverBaselineSnapshotRef.current = {
            elements: imported.map((e) => ({ ...e })),
            selectedType: null,
            cableFromId: null,
          };

          const draft = readSandboxDraftFromStorage(editProposalId);
          const shouldUseDraft =
            hasMeaningfulDraft(draft) &&
            draft.savedAt > 0 &&
            draft.savedAt >= parseIsoMs(p.updatedAt);

          if (shouldUseDraft) {
            replaceEditBootstrap({
              elements: draft.elements as SandboxElement[],
              selectedType: draft.selectedType as ElementType | null,
              cableFromId: draft.cableFromId,
            });
            setViewMode(draft.viewMode);
            savedCenterRef.current = draft.savedCenter;
            setMapZoom(draft.mapZoom);
            draftRestoredForEditRef.current = true;
          } else if (!draftRestoredForEditRef.current) {
            replaceEditBootstrap({
              elements: imported,
              selectedType: null,
              cableFromId: null,
            });
          }
        }
      } catch {
        if (!cancelled) setProposalLoadError('Не удалось загрузить предложение.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editProposalId, authorPubkey, replaceEditBootstrap]);

  const syncLeafletFromElements = useCallback((
    Leaflet: LeafletLib,
    map: InstanceType<LeafletLib['Map']>,
    els: SandboxElement[],
    selected: Set<string>,
  ) => {
    const leafMap = leafletLayersRef.current;
    for (const layer of [...leafMap.values()]) {
      try {
        map.removeLayer(layer);
      } catch {
        /* empty */
      }
    }
    leafMap.clear();

    for (const el of els) {
      if (isCable(el.type)) {
        const fromEl = els.find((x) => x.tempId === el.fromId);
        const toEl = els.find((x) => x.tempId === el.toId);
        if (!fromEl || !toEl) continue;
        const color = CABLE_COLORS[el.type] || '#ff9900';
        const isDashed = el.type.includes('UNDERGROUND');
        const isSel = selected.has(el.tempId);
        const lineGroup = createLayeredCableLayer(
          Leaflet,
          [[fromEl.lat, fromEl.lng], [toEl.lat, toEl.lng]],
          isSel ? '#78a0ff' : color,
          isDashed,
        ).addTo(map);
        lineGroup.bindTooltip(elementDisplayName(el), { sticky: true });
        const tid = el.tempId;
        leafMap.set(tid, lineGroup);
        lineGroup.eachLayer((sub) => {
          (sub as L.Path).on('click', (ev: L.LeafletEvent) => {
            const lme = ev as unknown as L.LeafletMouseEvent;
            const orig = lme.originalEvent;
            // Не вмешиваемся, если идёт постановка кабеля — для линий это всё равно неактивно.
            if (selectedTypeRef.current) return;
            if (orig && typeof orig.stopPropagation === 'function') orig.stopPropagation();
            const additive = !!orig && (orig.shiftKey || orig.ctrlKey || orig.metaKey);
            toggleSelectionRef.current(tid, additive);
          });
        });
      } else {
        const marker = Leaflet.marker([el.lat, el.lng], {
          draggable: true,
          icon: buildProposalNodeDivIcon(Leaflet, el.type),
        }).addTo(map);
        marker.bindPopup(elementDisplayName(el));
        marker.bindTooltip(elementDisplayName(el), { sticky: true });
        const tid = el.tempId;
        leafMap.set(tid, marker);
        if (selected.has(tid)) {
          const elNode = marker.getElement();
          if (elNode) elNode.classList.add('sandbox-marker--selected');
        }
        marker.on('dragend', () => {
          if (readOnlyInteractionRef.current) return;
          const pos = marker.getLatLng();
          applyEditMutationRef.current((prev) => ({
            ...prev,
            elements: prev.elements.map((x) =>
              x.tempId === tid ? { ...x, lat: pos.lat, lng: pos.lng } : x,
            ),
          }));
        });
        marker.on('click', (ev: L.LeafletMouseEvent) => {
          if (isCable(selectedTypeRef.current || '')) {
            patchPresentRef.current({ cableFromId: tid });
            return;
          }
          // Idle mode: toggle selection.
          if (selectedTypeRef.current) return;
          const orig = ev.originalEvent;
          const additive = !!orig && (orig.shiftKey || orig.ctrlKey || orig.metaKey);
          toggleSelectionRef.current(tid, additive);
        });
      }
    }
  }, []);

  // Persist draft (center read from ref; bump nonce on map moveend)
  useEffect(() => {
    if (!sandboxHydratedRef.current) return;
    const draft: SandboxDraftV1 = {
      version: SANDBOX_DRAFT_VERSION,
      savedAt: Date.now(),
      elements: elements as SandboxDraftV1['elements'],
      selectedType: selectedType as SandboxDraftV1['selectedType'],
      cableFromId,
      viewMode,
      savedCenter: savedCenterRef.current,
      mapZoom,
    };
    writeSandboxDraftToStorage(draft, editProposalId);
  }, [elements, selectedType, cableFromId, viewMode, mapZoom, mapCenterPersistNonce, editProposalId]);

  // 3D refs
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const globeGroupRef = useRef<THREE.Group | null>(null);
  const sandboxGroupRef = useRef<THREE.Group | null>(null);
  const threeInitRef = useRef(false);
  const animFrameRef = useRef(0);

  // --- SEARCH ---
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    setSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(q)}&limit=5`);
        if (res.ok) setSearchResults((await res.json()) as SearchResult[]);
      } catch { /* ignore */ }
      finally { setSearchLoading(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const handleSelectSearch = useCallback((r: SearchResult) => {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    if (viewMode === 'MAP_2D' && mapInstanceRef.current) {
      mapInstanceRef.current.setView([lat, lng], 12);
    } else if (viewMode === 'GLOBE_3D' && globeGroupRef.current) {
      orientGlobeGroupCenterFromLatLng(globeGroupRef.current, lat, lng);
    }
    setSearchQuery('');
    setSearchResults([]);
  }, [viewMode]);

  // --- 2D MAP ---
  useEffect(() => {
    if (viewMode !== 'MAP_2D' || !mapContainerRef.current) return;
    if (mapInstanceRef.current) return;
    let cancelled = false;
    const leafletLayers = leafletLayersRef.current;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapContainerRef.current) return;
      leafletRef.current = await import('leaflet');

      const c = savedCenterRef.current;
      const map = L.map(mapContainerRef.current, {
        center: [c.lat, c.lng],
        zoom: mapZoom,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '',
        maxZoom: 18,
      }).addTo(map);

      map.on('zoomend', () => setMapZoom(map.getZoom()));

      map.on('moveend', () => {
        const ctr = map.getCenter();
        savedCenterRef.current = { lat: ctr.lat, lng: ctr.lng };
        setMapCenterPersistNonce((n) => n + 1);
      });

      map.on('click', (e: L.LeafletMouseEvent) => {
        if (readOnlyInteractionRef.current) return;
        const curType = selectedTypeRef.current;
        if (!curType) {
          // Idle: клик по пустой карте снимает выделение.
          setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
          return;
        }

        if (isCable(curType)) {
          const fromId = cableFromIdRef.current;
          if (!fromId) return;
          const curElements = elementsRef.current;
          const fromEl = curElements.find(el => el.tempId === fromId);
          if (!fromEl) return;

          const closest = findClosestNode(curElements, e.latlng.lat, e.latlng.lng, fromId);
          if (!closest) return;

          const cableTid = tempId();
          const cableLat = fromEl.lat;
          const cableLng = fromEl.lng;
          const toId = closest.tempId;
          applyEditMutationRef.current((prev) => {
            const cable: SandboxElement = {
              tempId: cableTid,
              type: curType,
              name: generateNextAutoName(curType, prev.elements),
              lat: cableLat,
              lng: cableLng,
              fromId,
              toId,
            };
            return {
              ...prev,
              elements: [...prev.elements, cable],
              cableFromId: null,
            };
          });
          return;
        }

        const newTid = tempId();
        const newLat = e.latlng.lat;
        const newLng = e.latlng.lng;
        applyEditMutationRef.current((prev) => {
          const el: SandboxElement = {
            tempId: newTid,
            type: curType,
            name: generateNextAutoName(curType, prev.elements),
            lat: newLat,
            lng: newLng,
          };
          return {
            ...prev,
            elements: [...prev.elements, el],
          };
        });
      });

      mapInstanceRef.current = map;
      setMapReady(true);

      // Ensure tiles align after the container is laid out (handles flex height settling).
      const invalidate = () => {
        try {
          map.invalidateSize();
        } catch {
          /* map may have been removed during async init */
        }
      };
      requestAnimationFrame(invalidate);
      setTimeout(invalidate, 120);
    })();

    return () => {
      cancelled = true;
      setMapReady(false);
      const map = mapInstanceRef.current;
      if (map) {
        map.remove();
        mapInstanceRef.current = null;
      }
      leafletLayers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial zoom/center come from state/refs at mount; avoid map teardown on zoom
  }, [viewMode]);

  // Keep Leaflet aligned to the actual rendered map-area size (sidebar toggle, viewport resize, font load).
  useEffect(() => {
    if (viewMode !== 'MAP_2D' || !mapReady) return;
    const map = mapInstanceRef.current;
    const container = mapContainerRef.current?.parentElement ?? mapContainerRef.current;
    if (!map || !container) return;
    const ro = new ResizeObserver(() => {
      try { map.invalidateSize(); } catch { /* ignore */ }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [viewMode, mapReady]);

  // Rebuild Leaflet markers/lines from `elements` whenever map is ready (fixes Globe↔Map and navigation remounts).
  useEffect(() => {
    if (viewMode !== 'MAP_2D' || !mapReady) return;
    const map = mapInstanceRef.current;
    const Lmod = leafletRef.current;
    if (!map || !Lmod) return;
    const Leaf = (
      Lmod && typeof Lmod === 'object' && 'default' in Lmod && (Lmod as { default?: LeafletLib }).default
        ? (Lmod as { default: LeafletLib }).default
        : (Lmod as unknown as LeafletLib)
    );
    syncLeafletFromElements(Leaf, map, elements, selectedIds);
  }, [elements, viewMode, mapReady, selectedIds, syncLeafletFromElements]);

  function findClosestNode(els: SandboxElement[], lat: number, lng: number, excludeId: string): SandboxElement | null {
    let best: SandboxElement | null = null;
    let bestDist = Infinity;
    for (const el of els) {
      if (el.tempId === excludeId || isCable(el.type)) continue;
      const d = (el.lat - lat) ** 2 + (el.lng - lng) ** 2;
      if (d < bestDist) { bestDist = d; best = el; }
    }
    return bestDist < 25 ? best : null;
  }

  // --- 3D GLOBE ---
  useEffect(() => {
    if (viewMode !== 'GLOBE_3D' || !threeContainerRef.current || threeInitRef.current) return;
    threeInitRef.current = true;
    const mount = threeContainerRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060a18);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 2000);
    camera.position.set(0, 0, 3);
    cameraRef.current = camera;
    setGlobeZ(3);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.55;
    renderer.localClippingEnabled = true;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const sphereSegs = getEarthSphereSegments();
    const materialMode = getEarthMaterialMode();

    const hemi = new THREE.HemisphereLight(0x6b8cff, 0x081022, 0.72);
    scene.add(hemi);
    const ambient = new THREE.AmbientLight(0xffffff, 0.42);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 3.8);
    sun.position.set(4.5, 2.2, 5);
    scene.add(sun);
    if (materialMode === 'standard') {
      hemi.intensity = 0.78;
      ambient.intensity = 0.52;
      sun.intensity = 4.05;
    }

    const starsGeo = new THREE.BufferGeometry();
    const starCount = 1500;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 120 + Math.random() * 600;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    scene.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({ size: 0.6, sizeAttenuation: true, color: 0x9fb3ff })));

    const globeGroup = new THREE.Group();
    globeGroupRef.current = globeGroup;

    const globeGeo = new THREE.SphereGeometry(1, sphereSegs, sphereSegs);
    const fallbackMat = new THREE.MeshPhongMaterial({ color: 0x24517e, emissive: 0x144d7a, shininess: 10, specular: 0x2f3b62 });
    globeGroup.add(new THREE.Mesh(globeGeo, fallbackMat));

    const cloudGeo = new THREE.SphereGeometry(1.012, sphereSegs, sphereSegs);
    const cloudMat = new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    globeGroup.add(new THREE.Mesh(cloudGeo, cloudMat));

    const sandboxGroup = new THREE.Group();
    sandboxGroupRef.current = sandboxGroup;
    globeGroup.add(sandboxGroup);
    scene.add(globeGroup);

    // Add world labels
    const labelSprites: THREE.Object3D[] = [];
    for (const wl of WORLD_LABELS) {
      const labelR = wl.kind === 'water' ? 1.001 : 1.018;
      const pos = latLngToVec3(wl.lat, wl.lng, labelR);
      if (!pos) continue;
      const labelColor = wl.kind === 'water' ? '#80e0ff' : wl.kind === 'city' ? '#b0d4ff' : '#ffffff';
      const mesh = makeTextMesh(wl.text, pos, { color: labelColor, fontSize: wl.fontSize, kind: wl.kind });
      globeGroup.add(mesh);
      labelSprites.push(mesh);
    }

    const c = savedCenterRef.current;
    orientGlobeGroupCenterFromLatLng(globeGroup, c.lat, c.lng);

    loadEarthTextures(renderer).then((set) => {
      if (!set) return;
      let earthMat: THREE.Material;
      if (materialMode === 'standard') {
        earthMat = new THREE.MeshStandardMaterial({
          map: set.color, normalMap: set.normal, normalScale: new THREE.Vector2(0.055, 0.055),
          roughness: 0.62, metalness: 0.06, emissive: new THREE.Color(0x0b2d55), emissiveIntensity: 0.42,
        });
      } else {
        earthMat = new THREE.MeshPhongMaterial({
          map: set.color, normalMap: set.normal, normalScale: new THREE.Vector2(0.04, 0.04),
          shininess: 15, specular: new THREE.Color(0x2f3b62), emissive: new THREE.Color(0x0e3a6a), emissiveIntensity: 0.35,
        });
      }
      (globeGroup.children[0] as THREE.Mesh).material = earthMat;
      if (set.clouds) {
        (globeGroup.children[1] as THREE.Mesh).material = new THREE.MeshPhongMaterial({
          map: set.clouds, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide,
        });
      }
    });

    const trackball = attachGlobeTrackballControls({
      domElement: renderer.domElement,
      globeGroup,
      globeMesh: globeGroup.children[0] as THREE.Mesh,
      camera,
      zoomMin: GLOBE_Z_MIN,
      zoomMax: GLOBE_Z_MAX,
      onZoomApplied: (z) => setGlobeZ(z),
    });

    const raycaster = new THREE.Raycaster();
    const onClick = (e: MouseEvent) => {
      if (readOnlyInteractionRef.current) return;
      const curType = selectedTypeRef.current;
      const rect = mount.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);

      if (!curType) {
        // Idle-режим: клик по узлу включает/выключает выделение, Shift/Ctrl — additive.
        const nodeChildrenIdle = sandboxGroup.children.filter(
          (ch) => ch.userData && ch.userData.tempId && ch.userData.elType,
        );
        if (nodeChildrenIdle.length === 0) return;
        const idleHits = raycaster.intersectObjects(nodeChildrenIdle, true);
        if (idleHits.length === 0) return;
        let hitObj = idleHits[0].object;
        while (hitObj.parent && !hitObj.userData?.tempId) hitObj = hitObj.parent;
        if (!hitObj.userData?.tempId) return;
        const additive = e.shiftKey || e.ctrlKey || e.metaKey;
        toggleSelectionRef.current(hitObj.userData.tempId as string, additive);
        return;
      }

      if (isCable(curType)) {
        const nodeChildren = sandboxGroup.children.filter(
          (ch) => ch.userData && ch.userData.tempId && ch.userData.elType,
        );
        const nodeHits = raycaster.intersectObjects(nodeChildren, true);
        if (nodeHits.length === 0) return;
        let hitObj = nodeHits[0].object;
        while (hitObj.parent && !hitObj.userData?.tempId) hitObj = hitObj.parent;
        if (!hitObj.userData?.tempId) return;
        const hitId = hitObj.userData.tempId as string;

        const fromId = cableFromIdRef.current;
        if (!fromId) {
          patchPresentRef.current({ cableFromId: hitId });
          return;
        }
        if (fromId === hitId) return;
        const curElements = elementsRef.current;
        const fromEl = curElements.find((x) => x.tempId === fromId);
        const toEl = curElements.find((x) => x.tempId === hitId);
        if (!fromEl || !toEl) return;
        const cableTid = tempId();
        const cableLat = fromEl.lat;
        const cableLng = fromEl.lng;
        applyEditMutationRef.current((prev) => {
          const cable: SandboxElement = {
            tempId: cableTid,
            type: curType,
            name: generateNextAutoName(curType, prev.elements),
            lat: cableLat,
            lng: cableLng,
            fromId,
            toId: hitId,
          };
          return {
            ...prev,
            elements: [...prev.elements, cable],
            cableFromId: null,
          };
        });
        return;
      }

      const hits = raycaster.intersectObject(globeGroup.children[0] as THREE.Mesh);
      if (hits.length === 0) return;
      const point = hits[0].point;
      const localPoint = globeGroup.worldToLocal(point.clone());
      const r = localPoint.length();
      const lat = 90 - Math.acos(localPoint.y / r) * (180 / Math.PI);
      const lng = Math.atan2(localPoint.z, -localPoint.x) * (180 / Math.PI) - 180;
      const normLng = lng < -180 ? lng + 360 : lng > 180 ? lng - 360 : lng;
      const newTid = tempId();
      applyEditMutationRef.current((prev) => {
        const el: SandboxElement = {
          tempId: newTid,
          type: curType,
          name: generateNextAutoName(curType, prev.elements),
          lat,
          lng: normLng,
        };
        return {
          ...prev,
          elements: [...prev.elements, el],
        };
      });
    };

    const onClickWrapped = (e: MouseEvent) => {
      if (trackball.consumeGlobeDragClickSuppression()) return;
      onClick(e);
    };
    mount.addEventListener('click', onClickWrapped);

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      for (const sp of labelSprites) {
        const worldPos = new THREE.Vector3();
        sp.getWorldPosition(worldPos);
        const toLabel = worldPos.clone().sub(camera.position).normalize();
        sp.visible = camDir.dot(toLabel) > 0.15;
      }
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(() => onResize());
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      trackball.detach();
      mount.removeEventListener('click', onClickWrapped);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      threeInitRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // Rebuild 3D sandbox elements
  useEffect(() => {
    if (viewMode !== 'GLOBE_3D' || !sandboxGroupRef.current) return;
    const group = sandboxGroupRef.current;
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      disposeThreeObject(child);
    }

    const cableClipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.15);

    for (const el of elements) {
      if (isCable(el.type)) {
        const fromEl = elements.find(x => x.tempId === el.fromId);
        const toEl = elements.find(x => x.tempId === el.toId);
        if (!fromEl || !toEl) continue;
        const pts = [latLngToVec3(fromEl.lat, fromEl.lng, 1.002), latLngToVec3(toEl.lat, toEl.lng, 1.002)].filter(Boolean) as THREE.Vector3[];
        if (pts.length < 2) continue;
        const colorHex = parseInt((CABLE_COLORS[el.type] || '#ff9900').replace('#', ''), 16);
        const isDashed = el.type.includes('UNDERGROUND');
        const mat = isDashed
          ? new THREE.LineDashedMaterial({ color: colorHex, transparent: true, opacity: 0.8, dashSize: 0.04, gapSize: 0.03, clippingPlanes: [cableClipPlane] })
          : new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9, clippingPlanes: [cableClipPlane] });
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, mat);
        if (isDashed) line.computeLineDistances();
        line.frustumCulled = false;
        group.add(line);
        continue;
      }

      const visual = NODE_VISUALS[el.type];
      if (!visual) continue;
      const nodeR =
        el.type === 'SATELLITE' || el.type === 'SATELLITE_RASSVET' ? 1.0 + 550 / 6371 : 1.012 + (visual.size - 0.01) * 0.9;
      const pos = latLngToVec3(el.lat, el.lng, nodeR);
      if (!pos) continue;
      const normal = pos.clone().normalize();

      let marker: THREE.Object3D;
      if (el.type === 'SATELLITE' || el.type === 'SATELLITE_RASSVET') {
        marker = createSatelliteObject(visual.size, visual.color, visual.emissive);
      } else {
        const factory = EQUIPMENT_FACTORIES[el.type];
        marker = factory
          ? factory(visual.size, visual.color, visual.emissive)
          : createSatelliteObject(visual.size, visual.color, visual.emissive);
      }
      marker.position.copy(pos);
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      marker.userData = { tempId: el.tempId, elType: el.type };
      if (selectedIds.has(el.tempId)) {
        marker.scale.setScalar(1.35);
      }
      group.add(marker);
    }

  }, [elements, viewMode, selectedIds]);

  // --- REMOVE ELEMENT ---
  const removeElement = useCallback((tid: string) => {
    applyEditMutation((prev) => {
      const el = prev.elements.find((e) => e.tempId === tid);
      let nextElements = prev.elements.filter((e) => e.tempId !== tid);
      if (el && !isCable(el.type)) {
        nextElements = nextElements.filter(
          (e) => !(isCable(e.type) && (e.fromId === tid || e.toId === tid)),
        );
      }
      return {
        ...prev,
        elements: nextElements,
        cableFromId: prev.cableFromId === tid ? null : prev.cableFromId,
      };
    });
  }, [applyEditMutation]);

  // Очистка выделения от ID-ов, которых уже нет в графе (после undo/redo, ручного "x", смены сети).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set<string>();
      const elemIds = new Set(elements.map((e) => e.tempId));
      for (const id of prev) {
        if (elemIds.has(id)) valid.add(id);
      }
      if (valid.size === prev.size) return prev;
      return valid;
    });
  }, [elements]);

  const refreshProposalHeadRevision = useCallback(async () => {
    if (!editProposalId) return;
    const r = await fetch(`/api/proposals/${encodeURIComponent(editProposalId)}`);
    if (!r.ok) return;
    const p = (await r.json()) as { headRevisionId?: string | null };
    setHeadRevisionId(typeof p.headRevisionId === 'string' ? p.headRevisionId : null);
  }, [editProposalId]);

  const refreshEditProposalMeta = useCallback(async (proposalId: string) => {
    const r = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}`);
    if (!r.ok) return;
    const p = (await r.json()) as {
      status?: string;
      onChainTxSignature?: string | null;
      _count?: { votes?: number };
      headRevisionId?: string | null;
      title?: string | null;
      description?: string | null;
      capabilities?: { commitSandboxGraphInPlace?: boolean };
    };
    setEditProposalMeta((prev) =>
      prev
        ? {
            ...prev,
            status: typeof p.status === 'string' ? p.status : prev.status,
            voteCount: typeof p._count?.votes === 'number' ? p._count.votes : prev.voteCount,
            onChainTxSignature:
              typeof p.onChainTxSignature === 'string' || p.onChainTxSignature === null
                ? p.onChainTxSignature
                : prev.onChainTxSignature,
            commitSandboxGraphInPlace:
              typeof p.capabilities?.commitSandboxGraphInPlace === 'boolean'
                ? p.capabilities.commitSandboxGraphInPlace
                : prev.commitSandboxGraphInPlace,
          }
        : prev,
    );
    if (typeof p.headRevisionId === 'string' || p.headRevisionId === null) {
      setHeadRevisionId(p.headRevisionId ?? null);
    }
    if (typeof p.title === 'string' || p.title === null) setProposalTitle(p.title ?? '');
    if (typeof p.description === 'string' || p.description === null) setProposalDesc(p.description ?? '');
  }, []);

  const assertSavePreconditions = useCallback((): string | null => {
    if (!authorPubkey || elements.length === 0) return 'Нет элементов для сохранения.';
    if (!connected || !signMessage) return 'Подключите кошелёк с поддержкой подписи сообщений.';
    if (!sessionVerified) return 'Нажмите «Авторизоваться» в шапке сайта.';
    if (editProposalId) {
      if (proposalLoadError) return proposalLoadError;
      if (!editProposalMeta) return 'Подождите загрузки предложения и повторите попытку.';
    }
    return null;
  }, [
    authorPubkey,
    elements.length,
    connected,
    signMessage,
    sessionVerified,
    editProposalId,
    proposalLoadError,
    editProposalMeta,
  ]);

  /** Новая сцена без привязки к proposalId — как раньше: create + actions + submit-draft. */
  const handleSaveNewScene = useCallback(async () => {
    const pre = assertSavePreconditions();
    if (pre) {
      setSaveError(pre);
      return;
    }
    if (!signMessage || !authorPubkey) return;

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const pRes = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'GLOBAL',
          authorPubkey,
          title: proposalTitle || 'Предложение сети',
          description: proposalDesc || undefined,
        }),
      });
      if (!pRes.ok) throw new Error(`Failed to create proposal: ${pRes.status}`);
      const proposal = await pRes.json();

      const message = `diploma-z96a action:add:${proposal.id}`;
      const encoded = new TextEncoder().encode(message);
      const sig = await signMessage(encoded);
      const sigBase58 = bs58.encode(sig);

      const creates = sandboxElementsToCreatePayloads(elements);
      for (const payload of creates) {
        const actionRes = await fetch(`/api/proposals/${proposal.id}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionType: 'CREATE', elementPayload: payload, authorPubkey, signature: sigBase58 }),
        });
        if (!actionRes.ok) {
          const err = await actionRes.json().catch(() => ({}));
          throw new Error(`Failed to add action: ${(err as Record<string, string>).error || actionRes.status}`);
        }
      }

      const submitRes = await fetch(`/api/proposals/${proposal.id}/submit-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorPubkey }),
      });
      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({}));
        throw new Error(`Failed to submit proposal: ${(err as Record<string, string>).error || submitRes.status}`);
      }

      setSaveSuccess(`Предложение отправлено на голосование! Перейдите в "Предложения" для просмотра.`);
      setShowSaveModal(false);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }, [
    assertSavePreconditions,
    authorPubkey,
    elements,
    proposalTitle,
    proposalDesc,
    signMessage,
  ]);

  /** Коммит в текущее предложение: POST revisions (+ submit-draft для DRAFT/WITHDRAWN). Метаданные карточки не меняются. */
  const handleSaveInCurrentProposal = useCallback(async () => {
    const pre = assertSavePreconditions();
    if (pre) {
      setSaveError(pre);
      return;
    }
    if (!editProposalId || !editProposalMeta || !signMessage || !authorPubkey) return;
    if (!commitMessage.trim()) {
      setSaveError('Укажите описание изменения (сообщение коммита).');
      return;
    }
    if (!canCommitSandboxGraphInPlaceFromMeta(editProposalMeta)) {
      setSaveError(
        'Для этого статуса запись в текущее предложение недоступна. Используйте «Сохранить как новое предложение».',
      );
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const pid = editProposalMeta.id;
      const st = editProposalMeta.status;

      const creates = sandboxElementsToCreatePayloads(elements);
      const baseRev = headRevisionId;
      const revMsg = `diploma-z96a propose:revision:${pid}:${baseRev ?? 'null'}`;
      const revSig = await signMessage(new TextEncoder().encode(revMsg));
      const revRes = await fetch(`/api/proposals/${encodeURIComponent(pid)}/revisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature: bs58.encode(revSig),
          baseRevisionId: baseRev,
          message: commitMessage.trim(),
          creates,
        }),
      });
      if (revRes.status === 409) {
        const err = await revRes.json().catch(() => ({}));
        const code = (err as { code?: string }).code;
        if (code === 'revision_conflict') {
          await refreshProposalHeadRevision();
          throw new Error(
            'Конфликт ревизий: голова предложения изменилась. Обновите «head» (кнопка ниже) и повторите сохранение.',
          );
        }
        throw new Error((err as { error?: string }).error || 'Сохранение отклонено');
      }
      if (!revRes.ok) {
        const err = await revRes.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `revisions: ${revRes.status}`);
      }
      const revJson = (await revRes.json()) as { headRevisionId?: string };
      if (typeof revJson.headRevisionId === 'string') setHeadRevisionId(revJson.headRevisionId);

      if (st === 'DRAFT' || st === 'WITHDRAWN') {
        const submitRes = await fetch(`/api/proposals/${encodeURIComponent(pid)}/submit-draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authorPubkey }),
        });
        if (!submitRes.ok) {
          const err = await submitRes.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `submit-draft: ${submitRes.status}`);
        }
        setEditProposalMeta((prev) =>
          prev ? { ...prev, status: 'SUBMITTED', voteCount: 0, onChainTxSignature: null } : null,
        );
        const revShort = typeof revJson.headRevisionId === 'string' ? revJson.headRevisionId.slice(0, 8) : 'n/a';
        setSaveSuccess(`Сохранено в текущем предложении #${pid}. Ревизия: ${revShort}. Отправлено на голосование.`);
      } else {
        const revShort = typeof revJson.headRevisionId === 'string' ? revJson.headRevisionId.slice(0, 8) : 'n/a';
        setSaveSuccess(`Сохранено в текущем предложении #${pid}. Ревизия: ${revShort}.`);
      }

      await refreshEditProposalMeta(pid);

      setShowSaveModal(false);
      setCommitMessage('');
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }, [
    assertSavePreconditions,
    editProposalId,
    editProposalMeta,
    signMessage,
    authorPubkey,
    commitMessage,
    elements,
    headRevisionId,
    refreshProposalHeadRevision,
    refreshEditProposalMeta,
  ]);

  /** Fork: новое предложение из текущей сцены. */
  const handleSaveAsNewProposal = useCallback(async () => {
    const pre = assertSavePreconditions();
    if (pre) {
      setSaveError(pre);
      return;
    }
    if (!signMessage || !authorPubkey) return;
    if (!proposalTitle.trim()) {
      setSaveError('Укажите название нового предложения.');
      return;
    }

    const forkMessage = `Fork from proposal ${editProposalId} at ${new Date().toISOString()}`;

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      if (!editProposalId) {
        setSaveError('Внутренняя ошибка: нет исходного предложения для fork.');
        return;
      }

      const creates = sandboxElementsToCreatePayloads(elements);

      const forkMsg = `diploma-z96a propose:fork:${editProposalId}`;
      const forkSig = await signMessage(new TextEncoder().encode(forkMsg));
      const forkRes = await fetch(`/api/proposals/${encodeURIComponent(editProposalId)}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorPubkey,
          signature: bs58.encode(forkSig),
          title: proposalTitle.trim(),
          description: proposalDesc.trim() || undefined,
          message: forkMessage,
          creates,
        }),
      });
      if (!forkRes.ok) {
        const err = await forkRes.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `fork: ${forkRes.status}`);
      }
      const forkJson = (await forkRes.json()) as { proposal?: { id: string } };
      const newId = forkJson.proposal?.id;
      if (!newId) throw new Error('fork: missing new proposal id');

      const submitRes = await fetch(`/api/proposals/${encodeURIComponent(newId)}/submit-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorPubkey }),
      });
      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `submit-draft: ${submitRes.status}`);
      }

      setSaveSuccess(
        `Создано новое предложение #${newId} (fork от #${editProposalId}). Исходное предложение не изменено.`,
      );
      setShowSaveModal(false);
      setCommitMessage('');
      router.replace(`/sandbox?proposalId=${encodeURIComponent(newId)}`);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }, [
    assertSavePreconditions,
    authorPubkey,
    signMessage,
    proposalTitle,
    proposalDesc,
    elements,
    editProposalId,
    router,
  ]);

  const handleZoom = useCallback((delta: number) => {
    if (viewMode === 'MAP_2D' && mapInstanceRef.current) {
      const m = mapInstanceRef.current;
      const next = Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, m.getZoom() + delta));
      m.setZoom(next);
    } else if (viewMode === 'GLOBE_3D' && cameraRef.current) {
      const z = applyGlobeZoomDelta({
        currentZ: cameraRef.current.position.z,
        zoomDelta: delta,
        zoomStep: GLOBE_Z_STEP,
        minZ: GLOBE_Z_MIN,
        maxZ: GLOBE_Z_MAX,
      });
      cameraRef.current.position.z = z;
      setGlobeZ(z);
    }
  }, [viewMode]);

  const nodeElements = elements.filter(e => !isCable(e.type));
  const cableElements = elements.filter(e => isCable(e.type));

  const sandboxInteractionLocked = useMemo(
    () =>
      Boolean(editProposalId) &&
      (!editProposalMeta ||
        !!proposalLoadError ||
        !canInteractEditSandboxProposal({ status: editProposalMeta.status as ProposalStatus })),
    [editProposalId, editProposalMeta, proposalLoadError],
  );
  readOnlyInteractionRef.current = sandboxInteractionLocked;

  const canCommitInPlace = useMemo(() => {
    if (!editProposalMeta) return false;
    return canCommitSandboxGraphInPlaceFromMeta(editProposalMeta);
  }, [editProposalMeta]);

  const historyActionsDisabled = sandboxInteractionLocked;
  const canUndo = !historyActionsDisabled && editHistory.past.length > 0;
  const canRedo = !historyActionsDisabled && editHistory.future.length > 0;
  const canJumpBaseline = !historyActionsDisabled && (
    editProposalId
      ? (editProposalMeta !== null && !proposalLoadError)
      : elements.length > 0 || selectedType !== null || cableFromId !== null
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextInputShortcutTarget(document.activeElement)) return;
      if (readOnlyInteractionRef.current) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.code === 'KeyZ' && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) {
          e.preventDefault();
          redo();
          return;
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size === 0) return;
        e.preventDefault();
        removeSelectedElements();
        return;
      }
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          e.preventDefault();
          clearSelection();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, removeSelectedElements, clearSelection, selectedIds]);

  // Сбрасываем выделение, когда режим переходит в read-only — чтобы не маячило в просмотре.
  useEffect(() => {
    if (sandboxInteractionLocked && selectedIds.size > 0) {
      setSelectedIds(new Set());
    }
  }, [sandboxInteractionLocked, selectedIds.size]);

  return (
    <div className="sandbox-root" style={{ height: '100vh', background: 'var(--bg)', display: 'flex', overflow: 'hidden' }}>
      <style>{`
        .sandbox-root { height: 100vh; overflow: hidden; }
        .sandbox-sidebar {
          width: 280px;
          flex-shrink: 0;
          padding: 60px 12px 12px;
          border-right: 1px solid var(--border);
          overflow-y: auto;
          background: var(--bg);
          height: 100%;
          min-height: 0;
        }
        .sandbox-map-area {
          flex: 1;
          position: relative;
          min-width: 0;
          min-height: 0;
          height: 100%;
          padding-top: 52px;
        }
        .sandbox-backdrop {
          display: none;
        }
        .sandbox-toggle-btn {
          display: none;
        }
        .sandbox-map-overlay-actions {
          position: absolute;
          left: 12px;
          top: 60px;
          z-index: 1000;
          pointer-events: auto;
          max-width: calc(100% - 24px);
          display: flex;
          gap: 12px;
        }
        .sandbox-map-overlay-mode {
          position: absolute;
          left: 12px;
          bottom: 12px;
          z-index: 1000;
          pointer-events: auto;
          max-width: calc(100% - 24px);
          display: flex;
          gap: 12px;
        }
        .sandbox-network-picker {
          position: relative;
        }
        .sandbox-network-picker__btn {
          width: 100%;
          font-size: 12px;
          padding: 6px 8px;
          border-radius: 8px;
          border: 1px solid rgba(232,236,255,0.15);
          background: rgba(255,255,255,0.04);
          color: var(--text);
          cursor: pointer;
          text-align: left;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        .sandbox-network-picker__btn:hover { background: rgba(255,255,255,0.07); }
        .sandbox-network-picker__btn:focus-visible {
          outline: 2px solid rgba(120,160,255,0.6);
          outline-offset: 1px;
        }
        .sandbox-network-picker__menu {
          position: absolute;
          left: 0;
          right: 0;
          top: calc(100% + 4px);
          background: rgba(18,22,40,0.98);
          border: 1px solid rgba(232,236,255,0.15);
          border-radius: 8px;
          max-height: 220px;
          overflow-y: auto;
          z-index: 1100;
          box-shadow: 0 8px 24px rgba(0,0,0,0.45);
          padding: 4px;
        }
        .sandbox-network-picker__option {
          display: block;
          width: 100%;
          padding: 6px 8px;
          font-size: 12px;
          background: transparent;
          color: var(--text);
          border: none;
          border-radius: 6px;
          cursor: pointer;
          text-align: left;
          line-height: 1.3;
        }
        .sandbox-network-picker__option:hover {
          background: rgba(120,160,255,0.18);
        }
        .sandbox-network-picker__option[aria-selected="true"] {
          background: rgba(120,160,255,0.28);
          color: #fff;
        }
        .sandbox-element-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 2px 6px;
          font-size: 11px;
          color: var(--muted);
          border-radius: 4px;
          gap: 6px;
          cursor: pointer;
          user-select: none;
        }
        .sandbox-element-row:hover { background: rgba(255,255,255,0.04); }
        .sandbox-element-row[aria-selected="true"] {
          background: rgba(120,160,255,0.22);
          color: var(--text);
        }
        .sandbox-element-row[aria-selected="true"]:hover { background: rgba(120,160,255,0.30); }
        .sandbox-element-row__main {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 1;
          min-width: 0;
        }
        .sandbox-element-row__main > .sandbox-element-row__name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sandbox-element-row__caption {
          flex: 1;
          min-width: 0;
          font-size: 11px;
          padding: 2px 4px;
          border-radius: 4px;
          border: 1px solid rgba(232,236,255,0.18);
          background: rgba(255,255,255,0.06);
          color: var(--text);
          outline: none;
        }
        .sandbox-element-row__caption:focus {
          border-color: rgba(120,160,255,0.6);
          background: rgba(255,255,255,0.10);
        }
        .sandbox-element-row__caption[disabled] {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .leaflet-marker-icon.sandbox-marker--selected,
        .proposal-node-icon.sandbox-marker--selected {
          outline: 2px solid #78a0ff;
          outline-offset: 2px;
          border-radius: 50%;
        }
        @media (max-width: 767px) {
          .sandbox-sidebar {
            position: fixed;
            left: 0;
            top: 52px;
            bottom: 0;
            width: 280px;
            z-index: 500;
            transform: translateX(-100%);
            height: auto;
          }
          .sandbox-sidebar.sandbox-sidebar--open {
            transform: translateX(0);
          }
          .sandbox-map-area {
            padding-top: 0;
            flex: 1;
            width: 100%;
          }
          .sandbox-backdrop {
            display: block;
            position: fixed;
            left: 0;
            right: 0;
            top: 52px;
            bottom: 0;
            z-index: 499;
            background: rgba(0,0,0,0.45);
            cursor: pointer;
          }
          .sandbox-map-overlay-mode {
            bottom: 70px;
          }
          .sandbox-toggle-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            position: fixed;
            bottom: 70px;
            right: 12px;
            z-index: 600;
            width: 44px;
            height: 44px;
            border-radius: 4px;
            border: 1px solid var(--border);
            background: var(--panel);
            color: var(--text);
            font-size: 20px;
            line-height: 1;
            cursor: pointer;
          }
        }
        @media (min-width: 768px) {
          .sandbox-backdrop {
            display: none !important;
          }
        }
      `}</style>
      {sidebarOpen && (
        <div
          className="sandbox-backdrop"
          role="presentation"
          aria-hidden
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* Left toolbar */}
      <div className={`sandbox-sidebar ${sidebarOpen ? 'sandbox-sidebar--open' : ''}`}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Песочница</h2>
        {authorPubkey ? (
          <div style={{ marginBottom: 10 }}>
            <label
              style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 4, fontWeight: 600 }}
              id="sandbox-network-picker-label"
            >
              Мои построенные сети
            </label>
            <div className="sandbox-network-picker" ref={networkPickerRef}>
              <button
                type="button"
                className="sandbox-network-picker__btn"
                aria-haspopup="listbox"
                aria-expanded={networkPickerOpen}
                aria-labelledby="sandbox-network-picker-label"
                onClick={() => setNetworkPickerOpen((o) => !o)}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(() => {
                    if (!editProposalId) {
                      return myNetworksLoading ? 'Загрузка списка…' : 'Новая сеть (черновик)';
                    }
                    const cur = myNetworks.find((p) => p.id === editProposalId);
                    if (!cur) return `Предложение ${editProposalId.slice(0, 6)}…`;
                    return `${cur.title?.trim() || `Предложение ${cur.id.slice(0, 6)}`} · ${cur.status}`;
                  })()}
                </span>
                <span aria-hidden style={{ opacity: 0.6, fontSize: 10 }}>{networkPickerOpen ? '▲' : '▼'}</span>
              </button>
              {networkPickerOpen && (
                <ul
                  className="sandbox-network-picker__menu"
                  role="listbox"
                  aria-labelledby="sandbox-network-picker-label"
                >
                  <li>
                    <button
                      type="button"
                      role="option"
                      aria-selected={!editProposalId}
                      className="sandbox-network-picker__option"
                      onClick={() => {
                        setNetworkPickerOpen(false);
                        if (editProposalId) router.replace('/sandbox');
                      }}
                    >
                      {myNetworksLoading ? 'Загрузка списка…' : 'Новая сеть (черновик)'}
                    </button>
                  </li>
                  {myNetworks.map((p) => {
                    const selected = editProposalId === p.id;
                    const label = `${p.title?.trim() || `Предложение ${p.id.slice(0, 6)}`} · ${p.status}`;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className="sandbox-network-picker__option"
                          onClick={() => {
                            setNetworkPickerOpen(false);
                            if (!selected) {
                              router.replace(`/sandbox?proposalId=${encodeURIComponent(p.id)}`);
                            }
                          }}
                        >
                          {label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : null}
        {editProposalId && (
          <div
            style={{
              fontSize: 11,
              color: '#e6c24a',
              marginBottom: 10,
              padding: '6px 8px',
              borderRadius: 8,
              background: 'rgba(201,162,39,0.12)',
              border: '1px solid rgba(201,162,39,0.25)',
            }}
          >
            Режим редактирования предложения
            {editProposalMeta ? ` · ${editProposalMeta.status}` : ' · загрузка…'}
            {editProposalMeta && !sandboxInteractionLocked ? ' · редактирование' : ''}
            {editProposalMeta && sandboxInteractionLocked && !proposalLoadError ? ' · только просмотр' : ''}
            {proposalLoadError ? ` — ${proposalLoadError}` : null}
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
          Выберите элемент, кликните на карту/глобус. Для кабелей: выберите тип кабеля, кликните на первый узел, затем на второй.
        </p>

        {/* Search */}
        <div style={{ marginBottom: 12, position: 'relative' }}>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Поиск поселения..."
            style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(232,236,255,0.15)', background: 'rgba(255,255,255,0.04)', color: 'var(--text)', fontSize: 12, outline: 'none' }}
          />
          {searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'rgba(18,22,40,0.98)', border: '1px solid rgba(232,236,255,0.15)', borderRadius: 8, maxHeight: 150, overflowY: 'auto', zIndex: 100 }}>
              {searchResults.map((r, i) => (
                <Button key={i} type="button" size="sm" onClick={() => handleSelectSearch(r)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', background: 'transparent', color: 'var(--text)', fontSize: 11, cursor: 'pointer' }}
                >
                  {r.display_name?.slice(0, 80) || `${r.lat}, ${r.lon}`}
                </Button>
              ))}
            </div>
          )}
          {searchLoading && <span style={{ position: 'absolute', right: 8, top: 7, fontSize: 10, color: 'var(--muted)' }}>...</span>}
        </div>

        {/* Element types */}
        {ELEMENT_TYPES.map((cat) => (
          <div key={cat.category} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase' }}>
              {cat.category}
            </div>
            {cat.types.map((t) => {
              /** Иконку/линию рисуем тем же способом, что и легенды на /networks/[id] и /global-network. */
              const legendItem = getLegendItem(t.type);
              return (
                <Button
                  key={t.type}
                  type="button"
                  size="sm"
                  disabled={sandboxInteractionLocked}
                  onClick={() => {
                    patchPresent({
                      selectedType: selectedType === t.type ? null : t.type,
                      cableFromId: null,
                    });
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', textAlign: 'left', padding: '5px 10px', marginBottom: 1,
                    borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12,
                    color: selectedType === t.type ? '#fff' : 'var(--text)',
                    background: selectedType === t.type ? 'rgba(120,160,255,0.25)' : 'transparent',
                  }}
                >
                  {legendItem ? (
                    legendItem.kind === 'node' ? (
                      <NetworkLegendNodeIcon item={legendItem} size={20} />
                    ) : (
                      <NetworkLegendLineSample item={legendItem} width={26} />
                    )
                  ) : (
                    t.color && (
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: t.color, flexShrink: 0 }} />
                    )
                  )}
                  {t.label}
                </Button>
              );
            })}
          </div>
        ))}

        {selectedType && isCable(selectedType) && (
          <div style={{ fontSize: 11, color: '#ffcc00', marginBottom: 8, padding: '4px 10px', background: 'rgba(255,204,0,0.1)', borderRadius: 6 }}>
            {cableFromId
              ? 'Кликните на второй узел для завершения кабеля'
              : 'Кликните на узел (начало кабеля)'}
          </div>
        )}

        {/* My Elements */}
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(232,236,255,0.10)', paddingTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
              Выделено: {selectedIds.size}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <Button
                type="button"
                size="xs"
                variant="danger"
                tone="danger"
                disabled={sandboxInteractionLocked || selectedIds.size === 0}
                onClick={() => removeSelectedElements()}
                title="Удалить выделенные элементы (Delete / Backspace)"
                aria-label="Удалить выделенные элементы"
              >
                Удалить ({selectedIds.size})
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={selectedIds.size === 0}
                onClick={() => clearSelection()}
                title="Снять выделение (Esc)"
                aria-label="Снять выделение"
              >
                Снять
              </Button>
            </div>
          </div>
          <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 0, marginBottom: 6 }}>
            Кликните строку или элемент на карте для выделения. Shift / Ctrl — добавить к выделению.
          </p>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            Узлы ({nodeElements.length})
          </div>
          <div style={{ maxHeight: 120, overflowY: 'auto' }} role="listbox" aria-multiselectable>
            {nodeElements.map((el) => {
              const isSel = selectedIds.has(el.tempId);
              return (
                <div
                  key={el.tempId}
                  className="sandbox-element-row"
                  role="option"
                  tabIndex={sandboxInteractionLocked ? -1 : 0}
                  aria-selected={isSel}
                  aria-disabled={sandboxInteractionLocked}
                  onClick={(e) => {
                    if (sandboxInteractionLocked) return;
                    toggleSelection(el.tempId, e.shiftKey || e.ctrlKey || e.metaKey);
                  }}
                  onKeyDown={(e) => {
                    if (sandboxInteractionLocked) return;
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      toggleSelection(el.tempId, e.shiftKey || e.ctrlKey || e.metaKey);
                    }
                  }}
                >
                  <span className="sandbox-element-row__main">
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: nodeColor(el.type), flexShrink: 0 }} />
                    <span>{el.type} ({el.lat.toFixed(2)}, {el.lng.toFixed(2)})</span>
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    disabled={sandboxInteractionLocked}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeElement(el.tempId);
                    }}
                    variant="ghost"
                    tone="danger"
                    style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: sandboxInteractionLocked ? 'default' : 'pointer', fontSize: 11, opacity: sandboxInteractionLocked ? 0.35 : 1 }}
                  >
                    x
                  </Button>
                </div>
              );
            })}
          </div>
          {cableElements.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginTop: 8, marginBottom: 4 }}>
                Кабели ({cableElements.length})
              </div>
              <div style={{ maxHeight: 80, overflowY: 'auto' }} role="listbox" aria-multiselectable>
                {cableElements.map((el) => {
                  const isSel = selectedIds.has(el.tempId);
                  return (
                    <div
                      key={el.tempId}
                      className="sandbox-element-row"
                      role="option"
                      tabIndex={sandboxInteractionLocked ? -1 : 0}
                      aria-selected={isSel}
                      aria-disabled={sandboxInteractionLocked}
                      onClick={(e) => {
                        if (sandboxInteractionLocked) return;
                        toggleSelection(el.tempId, e.shiftKey || e.ctrlKey || e.metaKey);
                      }}
                      onKeyDown={(e) => {
                        if (sandboxInteractionLocked) return;
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault();
                          toggleSelection(el.tempId, e.shiftKey || e.ctrlKey || e.metaKey);
                        }
                      }}
                    >
                      <span className="sandbox-element-row__main">
                        <span style={{ width: 10, height: 4, borderRadius: 1, background: CABLE_COLORS[el.type] || '#ff9900', flexShrink: 0 }} />
                        <span>{el.type.replace('CABLE_', '').replace('UNDERGROUND_', 'ПЗ ')}</span>
                      </span>
                      <Button
                        type="button"
                        size="xs"
                        disabled={sandboxInteractionLocked}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeElement(el.tempId);
                        }}
                        variant="ghost"
                        tone="danger"
                        style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: sandboxInteractionLocked ? 'default' : 'pointer', fontSize: 11, opacity: sandboxInteractionLocked ? 0.35 : 1 }}
                      >
                        x
                      </Button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Save */}
        <div style={{ marginTop: 14 }}>
          {connected ? (
            <Button
              onClick={() => {
                setCommitMessage('');
                setSaveModalTab(canCommitInPlace ? 'updateCurrent' : 'forkAsNew');
                setShowSaveModal(true);
              }}
              disabled={elements.length === 0 || sandboxInteractionLocked}
            >
              {editProposalId ? 'Сохранить предложение…' : 'Сохранить как предложение'}
            </Button>
          ) : (
            <p style={{ fontSize: 11, color: 'var(--muted)' }}>Подключите кошелёк для сохранения</p>
          )}
        </div>
        {saveError && (
          <div style={{ marginTop: 6 }}>
            <p style={{ fontSize: 11, color: '#ff6b6b' }}>{saveError}</p>
            {editProposalId && saveError.includes('Конфликт ревизий') ? (
              <Button type="button" onClick={() => void refreshProposalHeadRevision()} style={{ marginTop: 6 }}>
                Обновить head ревизии
              </Button>
            ) : null}
          </div>
        )}
        {saveSuccess && <p style={{ fontSize: 11, color: '#3ddc97', marginTop: 6 }}>{saveSuccess}</p>}

      </div>

      <Button
        type="button"
        size="icon-md"
        variant="ghost"
        className="sandbox-toggle-btn"
        onClick={() => setSidebarOpen(o => !o)}
        aria-expanded={sidebarOpen}
        aria-label={sidebarOpen ? 'Скрыть панель' : 'Показать панель'}
      >
        ☰
      </Button>

      {/* Map / Globe area */}
      <div className="sandbox-map-area">
        {viewMode === 'MAP_2D' && <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />}
        {viewMode === 'GLOBE_3D' && <div ref={threeContainerRef} style={{ width: '100%', height: '100%' }} />}

        <div className="sandbox-map-overlay-actions">
          <Panel title="Действия">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button
                type="button"
                size="icon-md"
                onClick={() => undo()}
                disabled={!canUndo}
                title="Отменить (Ctrl+Z, любая раскладка)"
                aria-label="Отменить последнее действие"
              >
                ←
              </Button>
              <Button
                type="button"
                size="icon-md"
                onClick={() => redo()}
                disabled={!canRedo}
                title="Вернуть (Ctrl+Y или Ctrl+Shift+Z, любая раскладка)"
                aria-label="Вернуть отменённое действие"
              >
                →
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => jumpToInitialSnapshot()}
                disabled={!canJumpBaseline}
                title={
                  editProposalId
                    ? 'Вернуть сеть к варианту с сервера при открытии редактора (можно отменить)'
                    : 'Очистить песочницу — вернуться к пустой сцене (можно отменить)'
                }
                aria-label={
                  editProposalId
                    ? 'К исходному варианту сети с сервера'
                    : 'Очистить песочницу'
                }
              >
                К началу
              </Button>
            </div>
          </Panel>
        </div>

        <div className="sandbox-map-overlay-mode">
          <Panel title="Режим">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button
                type="button"
                onClick={() => {
                  if (mapInstanceRef.current) {
                    const ctr = mapInstanceRef.current.getCenter();
                    savedCenterRef.current = { lat: ctr.lat, lng: ctr.lng };
                  }
                  setViewMode('GLOBE_3D');
                }}
                disabled={viewMode === 'GLOBE_3D'}
              >
                Глобус
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (globeGroupRef.current) {
                    const ctr = computeGlobeCenterLatLng(globeGroupRef.current);
                    if (ctr) savedCenterRef.current = ctr;
                  }
                  setViewMode('MAP_2D');
                }}
                disabled={viewMode === 'MAP_2D'}
              >
                Карта
              </Button>
              <Button
                type="button"
                onClick={() => handleZoom(1)}
                disabled={
                  viewMode === 'MAP_2D'
                    ? !mapInstanceRef.current || mapZoom >= MAP_ZOOM_MAX - 1e-6
                    : !cameraRef.current || globeZ <= GLOBE_Z_MIN + 1e-6
                }
                title="Ближе"
              >
                +
              </Button>
              <Button
                type="button"
                onClick={() => handleZoom(-1)}
                disabled={
                  viewMode === 'MAP_2D'
                    ? !mapInstanceRef.current || mapZoom <= MAP_ZOOM_MIN - 1e-6
                    : !cameraRef.current || globeZ >= GLOBE_Z_MAX - 1e-6
                }
                title="Дальше"
              >
                −
              </Button>
              <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--muted)' }}>
                {viewMode === 'MAP_2D' ? mapZoom.toFixed(0) : globeZ.toFixed(2)}
              </span>
            </div>
          </Panel>
        </div>

        {viewMode === 'MAP_2D' && mapReady && (
          <div
            style={{
              position: 'absolute',
              right: 12,
              bottom: 12,
              zIndex: 1000,
              pointerEvents: 'auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 36px)',
              gridTemplateRows: 'repeat(3, 36px)',
              gap: 2,
            }}
          >
            {[
              { label: '\u2196', dx: -100, dy: -100 },
              { label: '\u2191', dx: 0, dy: -100 },
              { label: '\u2197', dx: 100, dy: -100 },
              { label: '\u2190', dx: -100, dy: 0 },
              { label: '', dx: 0, dy: 0 },
              { label: '\u2192', dx: 100, dy: 0 },
              { label: '\u2199', dx: -100, dy: 100 },
              { label: '\u2193', dx: 0, dy: 100 },
              { label: '\u2198', dx: 100, dy: 100 },
            ].map((dir, i) =>
              dir.label ? (
                <Button
                  key={i}
                  type="button"
                  size="icon-md"
                  onClick={() => mapInstanceRef.current?.panBy([dir.dx, dir.dy])}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 4,
                    border: `1px solid ${colors.border}`,
                    background: colors.bg.card,
                    color: colors.text.primary,
                    fontSize: 16,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {dir.label}
                </Button>
              ) : (
                <div key={i} />
              ),
            )}
          </div>
        )}

        {selectedType && (
          <div style={{ position: 'absolute', top: 62, left: '50%', transform: 'translateX(-50%)', background: colors.bg.card, border: `1px solid ${colors.border}`, borderRadius: 4, padding: '6px 14px', fontSize: 12, color: colors.accent, zIndex: 1000, pointerEvents: 'none' }}>
            Размещение: {ELEMENT_TYPES.flatMap(c => c.types).find(t => t.type === selectedType)?.label ?? selectedType}
            {isCable(selectedType) ? ' (кликните на узлы)' : ' (клик на карту/глобус)'}
          </div>
        )}

      </div>

      {/* Save modal */}
      {showSaveModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
          onClick={() => {
            setShowSaveModal(false);
          }}
        >
          <div style={{ background: colors.bg.card, border: `1px solid ${colors.border}`, borderRadius: 4, padding: '28px 32px', maxWidth: 480, width: '90%' }} onClick={e => e.stopPropagation()}>
            {!editProposalId ? (
              <>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>Новое предложение</h3>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Название</label>
                  <input
                    value={proposalTitle}
                    onChange={e => setProposalTitle(e.target.value)}
                    placeholder="Устойчивая сеть для Мозырского района"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: `1px solid ${colors.border}`, background: colors.bg.primary, color: colors.text.primary, fontSize: 14, outline: 'none' }}
                  />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Описание</label>
                  <textarea
                    value={proposalDesc}
                    onChange={e => setProposalDesc(e.target.value)}
                    placeholder="Опишите архитектуру..."
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: `1px solid ${colors.border}`, background: colors.bg.primary, color: colors.text.primary, fontSize: 14, outline: 'none', resize: 'none', height: 100, overflowY: 'auto' }}
                  />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <Button type="button" onClick={() => void handleSaveNewScene()} disabled={saving || !sessionVerified}>
                    {saving ? 'Сохранение...' : `Сохранить (${elements.length} эл.)`}
                  </Button>
                  <Button type="button" onClick={() => { setShowSaveModal(false); }}>Отмена</Button>
                </div>
              </>
            ) : canCommitInPlace ? (
              <>
                <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                  <Button
                    type="button"
                    onClick={() => { setSaveModalTab('updateCurrent'); }}
                    disabled={saving}
                    style={
                      saveModalTab === 'updateCurrent'
                        ? { borderColor: colors.accent, boxShadow: `0 0 0 1px ${colors.accent}` }
                        : undefined
                    }
                  >
                    Обновить текущее (тот же ID)
                  </Button>
                  <Button
                    type="button"
                    onClick={() => { setSaveModalTab('forkAsNew'); }}
                    disabled={saving}
                    style={
                      saveModalTab === 'forkAsNew'
                        ? { borderColor: colors.accent, boxShadow: `0 0 0 1px ${colors.accent}` }
                        : undefined
                    }
                  >
                    Новое предложение (новый ID)
                  </Button>
                </div>

                {saveModalTab === 'updateCurrent' ? (
                  <>
                    <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Обновить текущее предложение (ID не изменится)</h3>
                    <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                      Будет создана новая ревизия в этом же предложении. ID останется прежним.
                    </p>
                    {headRevisionId ? (
                      <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
                        Текущая ревизия (head): <code style={{ fontSize: 10 }}>{headRevisionId.slice(0, 12)}…</code>
                      </p>
                    ) : null}
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                        Описание изменения сети (коммит)
                      </label>
                      <textarea
                        value={commitMessage}
                        onChange={e => setCommitMessage(e.target.value)}
                        placeholder="Например: добавлены VSAT-узлы на восточном периметре"
                        style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: `1px solid ${colors.border}`, background: colors.bg.primary, color: colors.text.primary, fontSize: 14, outline: 'none', resize: 'none', height: 88, overflowY: 'auto' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <Button
                        type="button"
                        onClick={() => void handleSaveInCurrentProposal()}
                        disabled={saving || !sessionVerified || sandboxInteractionLocked || !commitMessage.trim()}
                      >
                        {saving ? 'Сохранение...' : 'Сохранить изменения'}
                      </Button>
                      <Button type="button" onClick={() => { setShowSaveModal(false); }}>Отмена</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>Создать новое предложение (fork, новый ID)</h3>
                    <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                      Будет создано новое предложение на основе текущего. Исходное предложение останется без изменений.
                    </p>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Название</label>
                      <input
                        value={proposalTitle}
                        onChange={e => setProposalTitle(e.target.value)}
                        placeholder="Название нового предложения"
                        style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: `1px solid ${colors.border}`, background: colors.bg.primary, color: colors.text.primary, fontSize: 14, outline: 'none' }}
                      />
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Описание</label>
                      <textarea
                        value={proposalDesc}
                        onChange={e => setProposalDesc(e.target.value)}
                        placeholder="Опционально"
                        style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: `1px solid ${colors.border}`, background: colors.bg.primary, color: colors.text.primary, fontSize: 14, outline: 'none', resize: 'none', height: 100, overflowY: 'auto' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <Button
                        type="button"
                        onClick={() => void handleSaveAsNewProposal()}
                        disabled={saving || !sessionVerified || sandboxInteractionLocked || !proposalTitle.trim()}
                      >
                        {saving ? 'Сохранение...' : 'Сохранить как новое'}
                      </Button>
                      <Button type="button" onClick={() => { setShowSaveModal(false); }}>Отмена</Button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Создать новое предложение (fork, новый ID)</h3>
                <p style={{ fontSize: 11, color: '#f6c177', marginBottom: 14 }}>
                  Для этого статуса запись в текущее предложение недоступна. Укажите название и описание нового предложения (новый ID).
                </p>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Название</label>
                  <input
                    value={proposalTitle}
                    onChange={e => setProposalTitle(e.target.value)}
                    placeholder="Название нового предложения"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: `1px solid ${colors.border}`, background: colors.bg.primary, color: colors.text.primary, fontSize: 14, outline: 'none' }}
                  />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Описание</label>
                  <textarea
                    value={proposalDesc}
                    onChange={e => setProposalDesc(e.target.value)}
                    placeholder="Опционально"
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 4, border: `1px solid ${colors.border}`, background: colors.bg.primary, color: colors.text.primary, fontSize: 14, outline: 'none', resize: 'none', height: 100, overflowY: 'auto' }}
                  />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <Button
                    type="button"
                    onClick={() => void handleSaveAsNewProposal()}
                    disabled={saving || !sessionVerified || sandboxInteractionLocked || !proposalTitle.trim()}
                  >
                    {saving ? 'Сохранение...' : 'Сохранить как новое'}
                  </Button>
                  <Button type="button" onClick={() => { setShowSaveModal(false); }}>Отмена</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
