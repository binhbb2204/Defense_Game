import {
  measureRoadSegment,
  type RoadNode,
  type RoadSegment,
  type WaypointElevationMode,
  type WaypointSlopeMode,
} from '@tactical-td/shared';
import { SectionHeader } from './InspectorPrimitives';

export function RoadSegmentInspector({
  seg,
  displayName,
  nodeA,
  nodeB,
  graphNodes,
  graphSegments,
  importedAssetNames,
  onUpdateSegment,
  onToggleKind,
  onSplitMid,
  onDelete,
}: {
  seg: RoadSegment;
  displayName?: string;
  nodeA: RoadNode | undefined;
  nodeB: RoadNode | undefined;
  graphNodes?: readonly RoadNode[];
  graphSegments?: readonly RoadSegment[];
  importedAssetNames: string[];
  onUpdateSegment: (segId: string, patch: Partial<Omit<RoadSegment, 'id' | 'a' | 'b'>>) => void;
  onToggleKind: (segId: string) => void;
  onSplitMid: (segId: string) => void;
  onDelete: () => void;
}) {
  const stats = nodeA && nodeB ? measureRoadSegment(nodeA, nodeB, seg, graphNodes, graphSegments) : null;

  return (
    <div className="space-y-1.5 p-2">
      <SectionHeader title={displayName ?? `Segment ${seg.id}`} subtitle={seg.id} />
      <div className="prop-row">
        <div className="prop-name">Width (m)</div>
        <div className="prop-value">
          <input
            type="number"
            min={2}
            max={16}
            step={0.4}
            value={seg.width}
            onChange={(e) => onUpdateSegment(seg.id, { width: Math.max(2, Number(e.target.value) || 5.2) })}
          />
        </div>
      </div>
      <div className="prop-row">
        <div className="prop-name">Route Weight</div>
        <div className="prop-value">
          <input
            type="number"
            min={0.1}
            max={100}
            step={0.5}
            value={seg.weight ?? 1}
            onChange={(e) => onUpdateSegment(seg.id, { weight: Math.max(0.1, Number(e.target.value) || 1) })}
          />
        </div>
      </div>
      <div className="prop-row">
        <div className="prop-name">Geometry</div>
        <div className="prop-value flex gap-1">
          <button
            type="button"
            onClick={() => { if (seg.kind !== 'straight') onToggleKind(seg.id); }}
            className={`dcc-btn flex-1 !min-h-[22px] text-[11px] ${seg.kind === 'straight' ? 'active' : ''}`}
          >
            Straight
          </button>
          <button
            type="button"
            onClick={() => { if (seg.kind !== 'curve') onToggleKind(seg.id); }}
            className={`dcc-btn flex-1 !min-h-[22px] text-[11px] ${seg.kind === 'curve' ? 'active' : ''}`}
          >
            Curve
          </button>
        </div>
      </div>
      {seg.kind === 'curve' && !seg.control && (
        <div className="prop-row">
          <div className="prop-name">Tension</div>
          <div className="prop-value flex items-center gap-1.5">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={seg.tension ?? 0.5}
              onChange={(e) => onUpdateSegment(seg.id, { tension: Number(e.target.value) })}
              className="flex-1 accent-[#3b82f6]"
            />
            <span className="mono-num w-8 text-right text-[10px]">
              {(seg.tension ?? 0.5).toFixed(2)}
            </span>
          </div>
        </div>
      )}
      <div className="prop-row">
        <div className="prop-name">One-Way</div>
        <div className="prop-value">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px]">
            <input
              type="checkbox"
              checked={Boolean(seg.oneWay)}
              onChange={(e) => onUpdateSegment(seg.id, { oneWay: e.target.checked ? true : undefined })}
            />
            <span>Enforce direction (a -&gt; b)</span>
          </label>
        </div>
      </div>
      <div className="prop-row">
        <div className="prop-name">Elevation</div>
        <div className="prop-value">
          <select
            value={seg.elevationMode ?? (seg.isTunnel ? 'tunnel' : seg.isOverpass ? 'bridge' : 'ground')}
            onChange={(e) => {
              const mode = e.target.value as WaypointElevationMode;
              onUpdateSegment(seg.id, {
                elevationMode: mode,
                isTunnel: mode === 'tunnel',
                isOverpass: mode === 'bridge' || mode === 'elevated',
              });
            }}
          >
            <option value="ground">Ground</option>
            <option value="elevated">Elevated</option>
            <option value="bridge">Bridge + Pillars</option>
            <option value="tunnel">Tunnel (Blocks LoS)</option>
          </select>
        </div>
      </div>
      <div className="prop-row">
        <div className="prop-name">Slope Profile</div>
        <div className="prop-value">
          <select
            value={seg.slopeMode ?? 'straight_slope'}
            onChange={(e) => onUpdateSegment(seg.id, { slopeMode: e.target.value as WaypointSlopeMode })}
          >
            <option value="straight_slope">Linear Ramp</option>
            <option value="pchip_smooth">PCHIP Smooth</option>
          </select>
        </div>
      </div>
      {importedAssetNames.length > 0 && (
        <div className="prop-row">
          <div className="prop-name">3D Part</div>
          <div className="prop-value">
            <select
              value={seg.roadPartAsset ?? ''}
              onChange={(e) => onUpdateSegment(seg.id, { roadPartAsset: e.target.value || undefined })}
            >
              <option value="">Procedural Ribbon</option>
              {importedAssetNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      {stats && (
        <div className="prop-row">
          <div className="prop-name">Metrics</div>
          <div className="prop-value mono-num text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {stats.length.toFixed(1)}m | Grade {stats.maxSlopePct.toFixed(0)}%
            {Number.isFinite(stats.minTurnRadius) ? ` | R=${stats.minTurnRadius.toFixed(1)}m` : ''}
          </div>
        </div>
      )}
      <div className="flex gap-1.5 pt-1">
        <button
          type="button"
          onClick={() => onSplitMid(seg.id)}
          className="dcc-btn flex-1"
          style={{ border: '1px solid var(--border-strong)' }}
        >
          <i className="fas fa-plus text-[10px]" />
          <span>Insert Node</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex-1 cursor-pointer rounded-[4px] border px-2 py-1 text-[11px] font-medium"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.14)',
            borderColor: 'var(--semantic-error)',
            color: '#fca5a5',
          }}
        >
          <i className="fas fa-trash-alt mr-1" />
          Delete Seg
        </button>
      </div>
    </div>
  );
}
