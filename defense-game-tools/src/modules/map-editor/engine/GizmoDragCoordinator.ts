import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  getMapGraph,
  syncGraphToLegacyWaypoints,
  type MapDefinition,
} from '@tactical-td/shared';
import { rebuildDirtyRoadComponents } from '../rendering';
import { applyGizmoObjectToDraft } from './GizmoTransformService';
import type { SceneSyncTargets } from './SceneObjectBuilder';
import { disposeObjectResources } from './threeDispose';
import type { ViewportEngineHost } from './ViewportTypes';

/**
 * Coordinates TransformControls drag sessions, undo snapshotting,
 * and RAF-throttled 2-hop dirty road mesh rebuilds during live node dragging.
 */
export class GizmoDragCoordinator {
  private liveRebuildRafId: number | null = null;
  private isGizmoDragging = false;
  private dragStartMap: MapDefinition | null = null;
  private dragDraftMap: MapDefinition | null = null;

  constructor(
    private readonly transformControls: TransformControls,
    private readonly targets: SceneSyncTargets,
    private readonly host: ViewportEngineHost,
  ) {
    this.bind();
  }

  public get isDragging(): boolean {
    return this.isGizmoDragging;
  }

  private bind(): void {
    this.transformControls.addEventListener('dragging-changed', (ev) => {
      const dragging = Boolean((ev as { value?: unknown }).value);
      this.isGizmoDragging = dragging;
      if (dragging) {
        this.dragStartMap = structuredClone(this.host.getMap());
        this.dragDraftMap = structuredClone(this.host.getMap());
        return;
      }

      if (this.liveRebuildRafId !== null) {
        cancelAnimationFrame(this.liveRebuildRafId);
        this.liveRebuildRafId = null;
      }
      const baseline = this.dragDraftMap ?? this.host.getMap();
      if (this.transformControls.object) {
        const { nextMap } = applyGizmoObjectToDraft(baseline, this.transformControls.object);
        if (this.dragStartMap) this.host.onPushUndoSnapshot(this.dragStartMap);
        this.host.onReplaceMapDirect(syncGraphToLegacyWaypoints(nextMap));
      }
      this.dragStartMap = null;
      this.dragDraftMap = null;
    });

    this.transformControls.addEventListener('objectChange', () => {
      if (!this.isGizmoDragging || !this.transformControls.object) return;
      const base = this.dragDraftMap ?? this.host.getMap();
      const { nextMap, mutatedNodeId, mutatedSegId } = applyGizmoObjectToDraft(
        base,
        this.transformControls.object,
      );
      this.dragDraftMap = nextMap;

      if ((mutatedNodeId || mutatedSegId) && this.liveRebuildRafId === null) {
        this.liveRebuildRafId = requestAnimationFrame(() => {
          this.liveRebuildRafId = null;
          if (!this.dragDraftMap) return;
          const movedIds = new Set<string>();
          if (mutatedNodeId) movedIds.add(mutatedNodeId);
          if (mutatedSegId) {
            const seg = getMapGraph(this.dragDraftMap).segments.find((s) => s.id === mutatedSegId);
            if (seg) {
              movedIds.add(seg.a);
              movedIds.add(seg.b);
            }
          }
          if (movedIds.size === 0 && !mutatedSegId) return;

          const rc = this.host.getRoadConfig();
          const selectedSegmentIds = new Set(
            this.host.getSelection().filter((s) => s.type === 'road_segment').map((s) => s.id),
          );
          rebuildDirtyRoadComponents(
            this.targets.roadMeshesGroup,
            this.targets.componentGroups,
            this.targets.segmentToComponent,
            this.dragDraftMap,
            movedIds,
            mutatedSegId,
            {
              selectedSegmentIds,
              hoveredSegmentId: null,
              hiddenSegmentIds: this.host.getHiddenIds(),
              anarchyEnabled: rc.anarchyEnabled,
              joinStyle: rc.roadJoinStyle,
              showRoadDebug: rc.showRoadDebug,
              assetCache: this.host.getAssetCache(),
            },
            disposeObjectResources,
          );
        });
      }
    });
  }

  public dispose(): void {
    if (this.liveRebuildRafId !== null) {
      cancelAnimationFrame(this.liveRebuildRafId);
      this.liveRebuildRafId = null;
    }
  }
}
