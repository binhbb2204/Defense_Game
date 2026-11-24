import { useCallback, useEffect, useRef, useState } from 'react';
import { getMapGraph, migrateMapDefinition, type MapDefinition } from '@tactical-td/shared';
import { generateProceduralMap, type DsaMapAlgorithm } from '../generators';
import type { ConsoleLogEntry, SelectionItem } from '../types';

export function isMapEmpty(m: MapDefinition): boolean {
  const g = getMapGraph(m);
  return (
    g.nodes.length === 0 &&
    g.segments.length === 0 &&
    m.obstacles.length === 0 &&
    m.elevatedZones.length === 0 &&
    (m.customModels?.length ?? 0) === 0
  );
}

const nowStamp = () => {
  const d = new Date();
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

export interface ModalVisibilityState {
  template: boolean;
  gen: boolean;
  prefs: boolean;
  saveAs: boolean;
  json: boolean;
}

/**
 * Owns console logs, modal visibility state, and procedural DSA map generation state
 * for MapEditor so the shell remains lightweight.
 */
export function useEditorDialogsAndLogs({
  map,
  bottomCollapsed,
  bottomTab,
  commitMap,
  onClearSelection,
  onResetRoadState,
  onDismissWelcome,
  onNotify,
}: {
  map: MapDefinition;
  bottomCollapsed: boolean;
  bottomTab: 'output' | 'validation';
  commitMap: (next: MapDefinition, pushHistory?: boolean) => void;
  onClearSelection: () => void;
  onResetRoadState: () => void;
  onDismissWelcome: () => void;
  onNotify: (type: 'ok' | 'err', text: string) => void;
}) {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [modals, setModals] = useState<ModalVisibilityState>({
    template: false,
    gen: false,
    prefs: false,
    saveAs: false,
    json: false,
  });
  const [dsaAlgo, setDsaAlgo] = useState<DsaMapAlgorithm>('astar_highway');
  const [dsaSeed, setDsaSeed] = useState(2026);
  const [dsaDensity, setDsaDensity] = useState(0.5);
  const [dsaW, setDsaW] = useState(map.bounds.width);
  const [dsaD, setDsaD] = useState(map.bounds.depth);
  const [logFilter, setLogFilter] = useState('');
  const [logs, setLogs] = useState<ConsoleLogEntry[]>(() => [
    {
      id: 1,
      time: nowStamp(),
      tag: 'Studio',
      level: 'info',
      message: 'Initialized on empty map. Left-drag pans | Right-drag orbits | Wheel zooms.',
    },
  ]);

  const pushLog = useCallback((tag: string, level: ConsoleLogEntry['level'], message: string) => {
    setLogs((prev) => [
      ...prev.slice(-140),
      { id: (prev[prev.length - 1]?.id ?? 0) + 1, time: nowStamp(), tag, level, message },
    ]);
  }, []);

  useEffect(() => {
    if (logContainerRef.current && !bottomCollapsed && bottomTab === 'output') {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, bottomCollapsed, bottomTab]);

  const randomizeDsa = useCallback(() => {
    const algs: DsaMapAlgorithm[] = ['astar_highway', 'dfs_canyon', 'dijkstra_contour', 'prim_mst'];
    setDsaAlgo(algs[Math.floor(Math.random() * algs.length)]!);
    setDsaSeed(Math.floor(Math.random() * 99999));
    setDsaDensity(Number((0.3 + Math.random() * 0.6).toFixed(1)));
  }, []);

  const runProceduralGeneration = () => {
    const generated = generateProceduralMap({
      algorithm: dsaAlgo,
      seed: dsaSeed,
      obstacleDensity: dsaDensity,
      mapId: map.id === 'untitled_map' ? 'procedural_map' : map.id,
      mapName: map.name === 'Untitled Map' ? `DSA ${dsaAlgo}` : map.name,
    });
    generated.bounds = { width: dsaW, depth: dsaD };
    generated.customModels = map.customModels ?? [];
    commitMap(migrateMapDefinition(generated));
    onClearSelection();
    onResetRoadState();
    setModals((m) => ({ ...m, gen: false }));
    onDismissWelcome();
    pushLog('DSA-Gen', 'ok', `Generated ${dsaAlgo} map (seed=${dsaSeed}).`);
    onNotify('ok', `Generated ${dsaAlgo} map`);
  };

  const togglePrimaryLosLock = (selection: SelectionItem[]) => {
    const primary = selection[0];
    if (!primary || (primary.type !== 'obstacle' && primary.type !== 'custom_model')) {
      onNotify('err', 'Select an obstacle or 3D model first.');
      return;
    }
    if (primary.type === 'obstacle') {
      commitMap({ ...map, obstacles: map.obstacles.map((o) => (o.id === primary.id ? { ...o, blocksLoS: !o.blocksLoS } : o)) });
    } else {
      commitMap({ ...map, customModels: (map.customModels ?? []).map((m) => (m.id === primary.id ? { ...m, blocksLoS: !m.blocksLoS } : m)) });
    }
  };

  return {
    logContainerRef,
    modals,
    setModals,
    dsaAlgo,
    setDsaAlgo,
    dsaSeed,
    setDsaSeed,
    dsaDensity,
    setDsaDensity,
    dsaW,
    setDsaW,
    dsaD,
    setDsaD,
    logFilter,
    setLogFilter,
    logs,
    setLogs,
    pushLog,
    randomizeDsa,
    runProceduralGeneration,
    togglePrimaryLosLock,
  };
}
