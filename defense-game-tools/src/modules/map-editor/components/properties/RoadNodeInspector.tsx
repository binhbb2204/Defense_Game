import type { RoadNode, RoadNodeRole, RoadSegment } from '@tactical-td/shared';
import type { EntityDisplayNames } from '../../utils/entityDisplayNames';
import { getNodeDisplayName } from '../../utils/entityDisplayNames';
import { SectionHeader, Vec3InputRow } from './InspectorPrimitives';

export function RoadNodeInspector({
  node,
  displayName,
  isDrawingAnchor,
  degree,
  graphNodes,
  graphSegments,
  entityNames,
  onUpdateNode,
  onDelete,
}: {
  node: RoadNode;
  displayName?: string;
  isDrawingAnchor?: boolean;
  degree: number;
  graphNodes: readonly RoadNode[];
  graphSegments: readonly RoadSegment[];
  entityNames: EntityDisplayNames;
  onUpdateNode: (nodeId: string, patch: Partial<Pick<RoadNode, 'x' | 'y' | 'z' | 'role' | 'label' | 'corner'>>) => void;
  onDelete: () => void;
}) {
  const nodeMap = new Map(graphNodes.map((n) => [n.id, n]));
  const linkedNeighbors = graphSegments
    .filter((s) => s.a === node.id || s.b === node.id)
    .map((s) => {
      const other = nodeMap.get(s.a === node.id ? s.b : s.a);
      if (!other) return null;
      const dist = Math.round(Math.hypot(other.x - node.x, other.z - node.z));
      return { name: getNodeDisplayName(entityNames, other), dist };
    })
    .filter((x): x is { name: string; dist: number } => Boolean(x));

  const subtitle = isDrawingAnchor ? 'last node' : `${degree} seg${degree === 1 ? '' : 's'}`;

  return (
    <div className="space-y-3 p-3">
      <SectionHeader title={displayName ?? node.id} subtitle={subtitle} />

      <div className="space-y-1">
        <div className="dcc-section-title">Role</div>
        <div className="dcc-seg-group">
          {(
            [
              { id: 'normal', label: 'Normal' },
              { id: 'spawn', label: 'Spawn' },
              { id: 'base', label: 'Base' },
            ] as const
          ).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onUpdateNode(node.id, { role: r.id as RoadNodeRole })}
              className={`dcc-seg-btn ${node.role === r.id ? 'active' : ''}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <Vec3InputRow
        label="Position"
        value={{ x: node.x, y: node.y, z: node.z }}
        onChange={(v) => onUpdateNode(node.id, { x: v.x, y: v.y, z: v.z })}
      />

      {linkedNeighbors.length > 0 && (
        <div className="flex items-start justify-between gap-2 text-[11px]">
          <span style={{ color: '#8c919a' }}>Linked to</span>
          <div className="mono-num text-right" style={{ color: '#e5e7eb' }}>
            {linkedNeighbors.slice(0, 3).map((n, idx) => (
              <div key={`${n.name}-${idx}`}>
                {n.name} · {n.dist} m
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2 border-t pt-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span style={{ color: '#8c919a' }}>Label</span>
          <input
            type="text"
            placeholder={displayName ?? node.id}
            value={node.label ?? ''}
            onChange={(e) => onUpdateNode(node.id, { label: e.target.value || undefined })}
            className="h-6 w-36 rounded-[4px] border px-2 text-[11px] outline-none focus:border-[#3b82f6]"
            style={{
              backgroundColor: 'var(--bg-input)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-[11px]" style={{ color: '#9aa0a9' }}>
          <input
            type="checkbox"
            checked={Boolean(node.corner)}
            onChange={(e) => onUpdateNode(node.id, { corner: e.target.checked ? true : undefined })}
            className="accent-[#3b82f6]"
          />
          <span>Sharp corner in Smooth mode</span>
        </label>

        <button
          type="button"
          onClick={onDelete}
          className="w-full cursor-pointer rounded-[4px] border px-2 py-1 text-[11px] font-medium hover:bg-[rgba(239,68,68,0.2)]"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            borderColor: 'rgba(239, 68, 68, 0.45)',
            color: '#fca5a5',
          }}
        >
          {degree === 2 ? 'Delete Node & Reconnect (Del)' : 'Delete Node (Del)'}
        </button>
      </div>
    </div>
  );
}
