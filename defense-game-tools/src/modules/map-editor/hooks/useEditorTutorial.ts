import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EditorTool } from '../types';

const STORAGE_KEY = 'defensekit_map_tutorial_v1';

export type TutorialStepId =
  | 'camera'
  | 'road'
  | 'roles'
  | 'multitool'
  | 'prop'
  | 'validate';

export interface TutorialStepView {
  id: TutorialStepId;
  number: number;
  title: string;
  summary: string;
  keys: string[];
  recommendedTool?: EditorTool;
  actionLabel: string;
  completed: boolean;
}

interface PersistedTutorialState {
  open: boolean;
  minimized: boolean;
  manualCompletedIds: TutorialStepId[];
}

function readStoredState(): PersistedTutorialState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { open: false, minimized: false, manualCompletedIds: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedTutorialState>;
    return {
      open: Boolean(parsed.open),
      minimized: Boolean(parsed.minimized),
      manualCompletedIds: Array.isArray(parsed.manualCompletedIds) ? parsed.manualCompletedIds : [],
    };
  } catch {
    return { open: false, minimized: false, manualCompletedIds: [] };
  }
}

export interface UseEditorTutorialParams {
  segmentCount: number;
  routesCount: number;
  hasCurvedSegment: boolean;
  propCount: number;
  validationIssueCount: number;
}

/**
 * Interactive 6-step onboarding tracker that detects real live progress on the canvas
 * (roads drawn, routes connected, curves applied, props placed, map saved).
 */
export function useEditorTutorial({
  segmentCount,
  routesCount,
  hasCurvedSegment,
  propCount,
  validationIssueCount,
}: UseEditorTutorialParams) {
  const [stored, setStored] = useState<PersistedTutorialState>(readStoredState);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [cameraUsed, setCameraUsed] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Ignore storage quota errors cleanly.
    }
  }, [stored]);

  const manualSet = useMemo(() => new Set(stored.manualCompletedIds), [stored.manualCompletedIds]);

  const steps: TutorialStepView[] = useMemo(
    () => [
      {
        id: 'camera',
        number: 1,
        title: 'Navigate the 3D Viewport',
        summary:
          'Use WASD / Q E to fly, Left-drag to pan, Right-drag to orbit, scroll the mouse wheel to zoom, or click Top / Iso at the bottom-right.',
        keys: ['WASD / Q E: Move', 'LMB Drag: Pan', 'RMB Drag: Orbit', 'Wheel: Zoom'],
        actionLabel: 'Mark Step Done',
        completed: cameraUsed || manualSet.has('camera'),
      },
      {
        id: 'road',
        number: 2,
        title: 'Draw a Connected Road Chain',
        summary:
          'Press G for Road, switch between Straight (1), Curve (2, 3-click), or Free (3, flowing 1-click curves). Snapping to nodes continues your chain; Right-click or Esc finishes it.',
        keys: ['G: Road', '1/2/3: Modes', 'Shift: Straight', 'RMB / Esc: Finish'],
        recommendedTool: 'road',
        actionLabel: 'Open Road Tool (G)',
        completed: segmentCount >= 2 || manualSet.has('road'),
      },
      {
        id: 'roles',
        number: 3,
        title: 'Assign Spawn & Base Endpoints',
        summary:
          'Use Select (1) to click a road end node and set Role to Spawn (green), then set the goal node Role to Base (red) so enemy routes compute.',
        keys: ['1: Select', 'Click Node -> Role'],
        recommendedTool: 't-select',
        actionLabel: 'Switch to Select (1)',
        completed: routesCount >= 1 || manualSet.has('roles'),
      },
      {
        id: 'multitool',
        number: 4,
        title: 'Smooth or Curve with Multitool',
        summary:
          'Switch to Multitool (T), choose Smooth or Curve, click the first node, click the last node of your bend, tune the slider, and press Apply (Enter).',
        keys: ['T: Multitool', 'Pick 2 Nodes', 'Enter: Apply'],
        recommendedTool: 'shape',
        actionLabel: 'Open Multitool (T)',
        completed: hasCurvedSegment || manualSet.has('multitool'),
      },
      {
        id: 'prop',
        number: 5,
        title: 'Place a Prop or Obstacle',
        summary:
          'Open Props Library (B), choose any prop card, press R to rotate if needed, and click the map to place cover or line-of-sight blockers.',
        keys: ['B: Props', 'R: Rotate', 'Click: Place'],
        recommendedTool: 'place',
        actionLabel: 'Open Props Library (B)',
        completed: propCount >= 1 || manualSet.has('prop'),
      },
      {
        id: 'validate',
        number: 6,
        title: 'Validate & Save Your Map',
        summary:
          validationIssueCount === 0
            ? 'Validation passed cleanly. Press Save (Ctrl+S) in the top bar to save map JSON and pack assets.'
            : `Resolve ${validationIssueCount} validation warning(s) in the bottom Validation pill, then press Save (Ctrl+S).`,
        keys: ['Ctrl+S: Save', 'F1: Full Reference'],
        actionLabel: 'Finish Tutorial',
        completed: savedOnce || manualSet.has('validate'),
      },
    ],
    [cameraUsed, hasCurvedSegment, manualSet, propCount, routesCount, savedOnce, segmentCount, validationIssueCount],
  );

  const completedCount = steps.filter((s) => s.completed).length;

  const startTutorial = useCallback(() => {
    setStored((prev) => ({ ...prev, open: true, minimized: false }));
  }, []);

  const closeTutorial = useCallback(() => {
    setStored((prev) => ({ ...prev, open: false }));
  }, []);

  const toggleMinimized = useCallback(() => {
    setStored((prev) => ({ ...prev, open: true, minimized: !prev.minimized }));
  }, []);

  const markStepDone = useCallback((id: TutorialStepId) => {
    setStored((prev) =>
      prev.manualCompletedIds.includes(id)
        ? prev
        : { ...prev, manualCompletedIds: [...prev.manualCompletedIds, id] },
    );
  }, []);

  const resetTutorial = useCallback(() => {
    setCameraUsed(false);
    setSavedOnce(false);
    setActiveStepIndex(0);
    setStored({ open: true, minimized: false, manualCompletedIds: [] });
  }, []);

  const markCameraUsed = useCallback(() => setCameraUsed(true), []);
  const markSaved = useCallback(() => setSavedOnce(true), []);

  return {
    open: stored.open,
    minimized: stored.minimized,
    activeStepIndex,
    steps,
    completedCount,
    totalSteps: steps.length,
    startTutorial,
    closeTutorial,
    toggleMinimized,
    goToStep: (idx: number) => setActiveStepIndex(Math.max(0, Math.min(steps.length - 1, idx))),
    markStepDone,
    resetTutorial,
    markCameraUsed,
    markSaved,
  };
}
