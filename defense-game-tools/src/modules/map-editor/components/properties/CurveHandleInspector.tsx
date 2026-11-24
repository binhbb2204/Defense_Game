import type { RoadSegment } from '@tactical-td/shared';
import { SectionHeader, Vec3InputRow } from './InspectorPrimitives';

export function CurveHandleInspector({
  seg,
  onUpdateSegment,
  onToggleSegmentKind,
}: {
  seg: RoadSegment;
  onUpdateSegment: (segId: string, patch: Partial<Omit<RoadSegment, 'id' | 'a' | 'b'>>) => void;
  onToggleSegmentKind: (segId: string) => void;
}) {
  if (!seg.control) return null;

  return (
    <div className="space-y-1.5 p-2">
      <SectionHeader title={`Curve Handle (${seg.id})`} />
      <Vec3InputRow
        label="Control"
        value={seg.control}
        onChange={(ctrl) => onUpdateSegment(seg.id, { kind: 'curve', control: ctrl })}
      />
      <button
        type="button"
        onClick={() => onToggleSegmentKind(seg.id)}
        className="dcc-btn w-full"
        style={{ border: '1px solid var(--border-strong)' }}
      >
        Revert to Straight
      </button>
    </div>
  );
}
