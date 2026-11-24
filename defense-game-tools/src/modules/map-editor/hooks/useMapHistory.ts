import { useCallback, useRef } from 'react';
import { syncGraphToLegacyWaypoints, type MapDefinition } from '@tactical-td/shared';
import type { ConsoleLogEntry } from '../types';

export function useMapHistory(
  map: MapDefinition,
  onChangeMap: (next: MapDefinition) => void,
  pushLog: (tag: string, level: ConsoleLogEntry['level'], message: string) => void,
) {
  const mapRef = useRef(map);
  mapRef.current = map;

  const undoStackRef = useRef<MapDefinition[]>([]);
  const redoStackRef = useRef<MapDefinition[]>([]);

  const pushUndoSnapshot = useCallback((snapshot: MapDefinition) => {
    undoStackRef.current = [...undoStackRef.current.slice(-49), snapshot];
    redoStackRef.current = [];
  }, []);

  const commitMap = useCallback(
    (next: MapDefinition, pushHistory = true) => {
      const synced = syncGraphToLegacyWaypoints(next);
      if (pushHistory) {
        undoStackRef.current = [...undoStackRef.current.slice(-49), structuredClone(mapRef.current)];
        redoStackRef.current = [];
      }
      onChangeMap(synced);
    },
    [onChangeMap],
  );

  const handleUndo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) {
      pushLog('Undo', 'warn', 'Nothing to undo.');
      return;
    }
    redoStackRef.current.push(structuredClone(mapRef.current));
    onChangeMap(prev);
    pushLog('Undo', 'action', `Undid action (${undoStackRef.current.length} left).`);
  }, [onChangeMap, pushLog]);

  const handleRedo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) {
      pushLog('Redo', 'warn', 'Nothing to redo.');
      return;
    }
    undoStackRef.current.push(structuredClone(mapRef.current));
    onChangeMap(next);
    pushLog('Redo', 'action', `Redid action (${redoStackRef.current.length} left).`);
  }, [onChangeMap, pushLog]);

  return {
    mapRef,
    commitMap,
    pushUndoSnapshot,
    handleUndo,
    handleRedo,
  };
}
