import { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  deleteNode,
  deleteSegment,
  getMapGraph,
  toggleRoadSegmentKind,
  type MapDefinition,
} from '@tactical-td/shared';
import { selectionKey, type ConsoleLogEntry, type SelectionItem } from '../types';

export function useEditorSelection(
  mapRef: React.MutableRefObject<MapDefinition>,
  commitMap: (next: MapDefinition, pushHistory?: boolean) => void,
  onClearRoadState: () => void,
  onRotateGhost: (deltaDeg: number) => void,
  pushLog: (tag: string, level: ConsoleLogEntry['level'], message: string) => void,
) {
  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [lockedIds, setLockedIds] = useState<Set<string>>(() => new Set());

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const hiddenIdsRef = useRef(hiddenIds);
  hiddenIdsRef.current = hiddenIds;
  const lockedIdsRef = useRef(lockedIds);
  lockedIdsRef.current = lockedIds;

  const selectItem = useCallback((item: SelectionItem | null, additive = false) => {
    if (!item) {
      setSelection([]);
      return;
    }
    setSelection((prev) => {
      const k = selectionKey(item);
      if (additive) {
        const exists = prev.some((x) => selectionKey(x) === k);
        return exists ? prev.filter((x) => selectionKey(x) !== k) : [...prev, item];
      }
      if (prev.length === 1 && selectionKey(prev[0]!) === k) {
        return [];
      }
      return [item];
    });
  }, []);

  const deleteSelectedItems = useCallback(
    (explicit?: SelectionItem[]) => {
      const items = explicit ?? selectionRef.current;
      if (items.length === 0) return;

      const cur = mapRef.current;
      let { nodes, segments } = getMapGraph(cur);
      let obstacles = [...cur.obstacles];
      let elevatedZones = [...cur.elevatedZones];
      let customModels = [...(cur.customModels ?? [])];

      for (const item of items) {
        if (item.type === 'road_node') {
          const res = deleteNode(nodes, segments, item.id);
          nodes = res.nodes;
          segments = res.segments;
        } else if (item.type === 'road_segment') {
          segments = deleteSegment(segments, item.id);
        } else if (item.type === 'curve_handle') {
          segments = toggleRoadSegmentKind(nodes, segments, item.id);
        } else if (item.type === 'obstacle') {
          obstacles = obstacles.filter((o) => o.id !== item.id);
        } else if (item.type === 'zone') {
          elevatedZones = elevatedZones.filter((z) => z.id !== item.id);
        } else if (item.type === 'custom_model') {
          customModels = customModels.filter((m) => m.id !== item.id);
        }
      }

      commitMap({ ...cur, nodes, segments, obstacles, elevatedZones, customModels });
      setSelection([]);
      onClearRoadState();
      pushLog('Delete', 'action', `Deleted ${items.length} item(s).`);
    },
    [commitMap, mapRef, onClearRoadState, pushLog],
  );

  const rotateSelectedOrGhost = useCallback(
    (deltaDeg: number) => {
      const sel = selectionRef.current;
      if (sel.length !== 1) {
        onRotateGhost(deltaDeg);
        return;
      }
      const primary = sel[0]!;
      const rad = THREE.MathUtils.degToRad(deltaDeg);
      const cur = mapRef.current;
      if (primary.type === 'obstacle') {
        commitMap({
          ...cur,
          obstacles: cur.obstacles.map((o) =>
            o.id === primary.id ? { ...o, rotationY: Number(((o.rotationY ?? 0) + rad).toFixed(3)) } : o,
          ),
        });
      } else if (primary.type === 'zone') {
        commitMap({
          ...cur,
          elevatedZones: cur.elevatedZones.map((z) =>
            z.id === primary.id ? { ...z, rotationY: Number(((z.rotationY ?? 0) + rad).toFixed(3)) } : z,
          ),
        });
      } else if (primary.type === 'custom_model') {
        commitMap({
          ...cur,
          customModels: (cur.customModels ?? []).map((m) =>
            m.id === primary.id ? { ...m, rotationY: Number((m.rotationY + rad).toFixed(3)) } : m,
          ),
        });
      } else {
        onRotateGhost(deltaDeg);
      }
    },
    [commitMap, mapRef, onRotateGhost],
  );

  const toggleHiddenIds = useCallback((ids: string[]) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      const allHidden = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allHidden) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const toggleLockedIds = useCallback((ids: string[]) => {
    setLockedIds((prev) => {
      const next = new Set(prev);
      const allLocked = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allLocked) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  return {
    selection,
    setSelection,
    selectionRef,
    hiddenIds,
    hiddenIdsRef,
    lockedIds,
    lockedIdsRef,
    selectItem,
    deleteSelectedItems,
    rotateSelectedOrGhost,
    toggleHiddenIds,
    toggleLockedIds,
  };
}
