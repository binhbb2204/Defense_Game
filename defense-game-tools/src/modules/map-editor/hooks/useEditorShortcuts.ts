import { useEffect, useRef } from 'react';
import type { MapDefinition, RoadBuildMode } from '@tactical-td/shared';
import { isTypingTarget, type ViewportEngine } from '../engine';
import { handleRoadBackspace, type RoadToolState } from '../tools';
import type { ConsoleLogEntry, EditorTool, SelectionItem } from '../types';

export interface EditorShortcutsParams {
  engineRef: React.MutableRefObject<ViewportEngine | null>;
  activeToolRef: React.MutableRefObject<EditorTool>;
  roadStateRef: React.MutableRefObject<RoadToolState>;
  roadUpgradeModeRef: React.MutableRefObject<boolean>;
  selectionRef: React.MutableRefObject<SelectionItem[]>;
  mapRef: React.MutableRefObject<MapDefinition>;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleAnarchy: () => void;
  onToggleRoadDebug: () => void;
  onStepElevation: (delta: number) => void;
  onResetElevation: () => void;
  onSetRoadState: (next: RoadToolState) => void;
  onSetRoadBlockedReason: (reason: string | null) => void;
  onSetRoadBuildMode: (mode: RoadBuildMode) => void;
  onToggleRoadUpgrade: () => void;
  onChangeMapDirect: (next: MapDefinition) => void;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
  onToggleLos: () => void;
  onToggleMinimap: () => void;
  onSetActiveTool: (tool: EditorTool) => void;
  onApplyShape: () => void;
  onEscapeShape: () => void;
  onRotate: (deg: number) => void;
  onToggleGuide?: () => void;
  onPushLog: (tag: string, level: ConsoleLogEntry['level'], msg: string) => void;
}

export function useEditorShortcuts(params: EditorShortcutsParams): void {
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget()) return;
      const p = paramsRef.current;
      const code = e.code;
      const key = e.key;

      if (code === 'F1') {
        e.preventDefault();
        p.onToggleGuide?.();
        return;
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && code === 'KeyG') {
        e.preventDefault();
        p.onToggleRoadDebug();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && code === 'KeyS') {
        e.preventDefault();
        p.onSave();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && code === 'KeyZ') {
        e.preventDefault();
        p.onUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (code === 'KeyY' || (e.shiftKey && code === 'KeyZ'))) {
        e.preventDefault();
        p.onRedo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && code === 'KeyA') {
        e.preventDefault();
        p.onToggleAnarchy();
        return;
      }
      const isPageUp = code === 'PageUp' || key === 'PageUp';
      const isPageDown = code === 'PageDown' || key === 'PageDown';
      if (isPageUp || isPageDown) {
        e.preventDefault();
        p.onStepElevation(isPageUp ? 2 : -2);
        return;
      }
      if (code === 'Home' || key === 'Home') {
        e.preventDefault();
        p.onResetElevation();
        return;
      }
      if (code === 'Enter') {
        if (p.activeToolRef.current === 'shape') {
          e.preventDefault();
          p.onApplyShape();
          return;
        }
        if (p.activeToolRef.current === 'road' && p.roadStateRef.current.status === 'drawing') {
          e.preventDefault();
          p.onSetRoadState({ status: 'idle' });
          p.onSetRoadBlockedReason(null);
          p.onPushLog('Road', 'ok', 'Finished drawing road chain.');
          return;
        }
      }
      if (code === 'Backspace') {
        if (p.activeToolRef.current === 'road' && p.roadStateRef.current.status === 'drawing') {
          e.preventDefault();
          const res = handleRoadBackspace(p.mapRef.current, p.roadStateRef.current);
          p.onSetRoadState(res.nextState);
          if (res.reverted) {
            p.onChangeMapDirect(res.nextMap);
            p.onPushLog('Road', 'action', res.message);
          }
          return;
        }
      }
      if (code === 'Delete') {
        if (p.selectionRef.current.length > 0) {
          e.preventDefault();
          p.onDeleteSelected();
        }
        return;
      }
      if (code === 'Escape') {
        if (p.activeToolRef.current === 'shape') {
          p.onEscapeShape();
          return;
        }
        if (p.activeToolRef.current === 'road') {
          if (p.roadUpgradeModeRef.current) {
            p.onToggleRoadUpgrade();
            return;
          }
          if (p.roadStateRef.current.status === 'drawing') {
            p.onSetRoadState({ status: 'idle' });
            p.onSetRoadBlockedReason(null);
            p.onPushLog('Road', 'action', 'Finished drawing road chain.');
            return;
          }
        }
        p.onSetRoadState({ status: 'idle' });
        p.onSetRoadBlockedReason(null);
        p.onClearSelection();
        if (p.activeToolRef.current === 'place' || p.activeToolRef.current === 'road') {
          p.onSetActiveTool('t-select');
        }
        return;
      }

      // While Road tool is active, 1/2/3 switch Straight/Curve/Free, U toggles Upgrade, and [ / ] step elevation
      if (p.activeToolRef.current === 'road') {
        if (code === 'Digit1') { p.onSetRoadBuildMode('straight'); return; }
        if (code === 'Digit2') { p.onSetRoadBuildMode('curve'); return; }
        if (code === 'Digit3') { p.onSetRoadBuildMode('free'); return; }
        if (code === 'KeyU') { p.onToggleRoadUpgrade(); return; }
        if (code === 'BracketRight' || key === ']' || code === 'NumpadAdd') {
          e.preventDefault();
          p.onStepElevation(2);
          return;
        }
        if (code === 'BracketLeft' || key === '[' || code === 'NumpadSubtract') {
          e.preventDefault();
          p.onStepElevation(-2);
          return;
        }
      } else {
        if (code === 'Digit1') { p.onSetActiveTool('t-select'); return; }
        if (code === 'Digit2') { p.onSetActiveTool('t-move'); return; }
        if (code === 'Digit3') { p.onSetActiveTool('t-rotate'); return; }
        if (code === 'Digit4') { p.onSetActiveTool('t-scale'); return; }
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (code === 'KeyB') p.onSetActiveTool('place');
      else if (code === 'KeyG') p.onSetActiveTool('road');
      else if (code === 'KeyT') p.onSetActiveTool('shape');
      else if (code === 'KeyX') p.onSetActiveTool('erase');
      else if (code === 'KeyL') p.onToggleLos();
      else if (code === 'KeyM') p.onToggleMinimap();
      else if (code === 'KeyR') p.onRotate(e.shiftKey ? -15 : 15);
      else if (code === 'KeyF') p.engineRef.current?.focusSelection(p.selectionRef.current[0]);
    };

    const onBlur = () => {
      const p = paramsRef.current;
      if (p.roadStateRef.current.status === 'drawing') {
        p.onSetRoadState({ status: 'idle' });
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
