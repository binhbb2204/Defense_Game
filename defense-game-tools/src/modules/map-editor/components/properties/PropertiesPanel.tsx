import {
  getMapGraph,
  type ElevatedZone,
  type MapCustomModel,
  type MapDefinition,
  type MapObstacle,
  type RoadNode,
  type RoadSegment,
} from '@tactical-td/shared';
import type { SelectionItem } from '../../types';
import {
  buildEntityDisplayNames,
  getNodeDisplayName,
  getSegmentDisplayName,
} from '../../utils/entityDisplayNames';
import { CurveHandleInspector } from './CurveHandleInspector';
import { PropEntityInspector } from './PropEntityInspector';
import { RoadNodeInspector } from './RoadNodeInspector';
import { RoadSegmentInspector } from './RoadSegmentInspector';

interface PropertiesPanelProps {
  map: MapDefinition;
  selection: SelectionItem[];
  drawingAnchorId?: string | null;
  importedAssetNames: string[];
  onUpdateNode: (nodeId: string, patch: Partial<Pick<RoadNode, 'x' | 'y' | 'z' | 'role' | 'label' | 'corner'>>) => void;
  onUpdateSegment: (segId: string, patch: Partial<Omit<RoadSegment, 'id' | 'a' | 'b'>>) => void;
  onToggleSegmentKind: (segId: string) => void;
  onSplitSegmentMid: (segId: string) => void;
  onUpdateObstacle: (id: string, patch: Partial<MapObstacle>) => void;
  onUpdateZone: (id: string, patch: Partial<ElevatedZone>) => void;
  onUpdateCustomModel: (id: string, patch: Partial<MapCustomModel>) => void;
  onDeleteSelection: () => void;
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { map, selection, onDeleteSelection } = props;

  if (selection.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Click a node, segment, or prop to edit. Click again to deselect.
      </div>
    );
  }

  if (selection.length > 1) {
    return (
      <div className="space-y-2 p-2.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-medium">{selection.length} items selected</span>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Shift/Ctrl+Click to toggle
          </span>
        </div>
        <button
          type="button"
          onClick={onDeleteSelection}
          className="w-full cursor-pointer rounded-[4px] border px-2 py-1 text-[11px] font-medium"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.14)',
            borderColor: 'var(--semantic-error)',
            color: '#fca5a5',
          }}
        >
          <i className="fas fa-trash-alt mr-1.5" />
          Delete Selected ({selection.length})
        </button>
      </div>
    );
  }

  const primary = selection[0]!;
  const { nodes, segments } = getMapGraph(map);
  const entityNames = buildEntityDisplayNames(nodes, segments);

  if (primary.type === 'road_node') {
    const node = nodes.find((n) => n.id === primary.id);
    if (!node) return null;
    const degree = segments.filter((s) => s.a === node.id || s.b === node.id).length;
    return (
      <RoadNodeInspector
        node={node}
        displayName={getNodeDisplayName(entityNames, node)}
        isDrawingAnchor={props.drawingAnchorId === node.id}
        degree={degree}
        graphNodes={nodes}
        graphSegments={segments}
        entityNames={entityNames}
        onUpdateNode={props.onUpdateNode}
        onDelete={onDeleteSelection}
      />
    );
  }

  if (primary.type === 'road_segment') {
    const seg = segments.find((s) => s.id === primary.id);
    if (!seg) return null;
    return (
      <RoadSegmentInspector
        seg={seg}
        displayName={getSegmentDisplayName(entityNames, seg)}
        nodeA={nodes.find((n) => n.id === seg.a)}
        nodeB={nodes.find((n) => n.id === seg.b)}
        graphNodes={nodes}
        graphSegments={segments}
        importedAssetNames={props.importedAssetNames}
        onUpdateSegment={props.onUpdateSegment}
        onToggleKind={props.onToggleSegmentKind}
        onSplitMid={props.onSplitSegmentMid}
        onDelete={onDeleteSelection}
      />
    );
  }

  if (primary.type === 'curve_handle') {
    const seg = segments.find((s) => s.id === primary.id);
    if (!seg) return null;
    return (
      <CurveHandleInspector
        seg={seg}
        onUpdateSegment={props.onUpdateSegment}
        onToggleSegmentKind={props.onToggleSegmentKind}
      />
    );
  }

  return (
    <PropEntityInspector
      obs={primary.type === 'obstacle' ? map.obstacles.find((o) => o.id === primary.id) : undefined}
      zone={primary.type === 'zone' ? map.elevatedZones.find((z) => z.id === primary.id) : undefined}
      mdl={primary.type === 'custom_model' ? (map.customModels ?? []).find((m) => m.id === primary.id) : undefined}
      onUpdateObstacle={props.onUpdateObstacle}
      onUpdateZone={props.onUpdateZone}
      onUpdateCustomModel={props.onUpdateCustomModel}
      onDelete={onDeleteSelection}
    />
  );
}
