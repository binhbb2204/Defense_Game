import type { WaypointElevationMode } from '@tactical-td/shared';

/** Road width, elevation, grade mode, and optional 3D mesh selector card for RoadDrawerPanel. */
export function RoadDrawerDimensions({
  roadWidth,
  drawElevation,
  elevationMode,
  importedAssetNames,
  selectedRoadPart,
  onChangeRoadWidth,
  onStepElevation,
  onResetElevation,
  onChangeElevationMode,
  onChangeRoadPart,
}: {
  roadWidth: number;
  drawElevation: number;
  elevationMode: WaypointElevationMode;
  importedAssetNames: string[];
  selectedRoadPart: string;
  onChangeRoadWidth: (width: number) => void;
  onStepElevation: (delta: number) => void;
  onResetElevation: () => void;
  onChangeElevationMode: (mode: WaypointElevationMode) => void;
  onChangeRoadPart: (assetName: string) => void;
}) {
  return (
    <section
      className="space-y-2.5 rounded-[4px] border p-2.5"
      style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="dcc-section-title">Road Width</span>
          <span className="mono-num font-medium" style={{ color: 'var(--text-primary)' }}>
            {roadWidth.toFixed(1)} m
          </span>
        </div>
        <input
          type="range"
          min={2}
          max={16}
          step={0.4}
          value={roadWidth}
          onChange={(e) => onChangeRoadWidth(Math.max(2, Number(e.target.value) || 5.2))}
          className="dcc-slider"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="dcc-section-title">Elevation</span>
          <span className="mono-num text-[10px]" style={{ color: 'var(--text-muted)' }}>
            PgUp/Dn · [ ]
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={drawElevation <= 0}
            onClick={() => onStepElevation(-2)}
            title="Lower 2m (PageDown or [)"
            className="dcc-btn !min-h-[26px] px-2 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ border: '1px solid var(--border-strong)', backgroundColor: 'var(--bg-panel)' }}
          >
            <i className="fas fa-minus text-[10px]" />
            <span className="mono-num text-[11px]">2m</span>
          </button>
          <button
            type="button"
            onClick={onResetElevation}
            title="Reset elevation to 0m (Home)"
            className="dcc-btn mono-num !min-h-[26px] flex-1 text-[11px]"
            style={{
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-panel)',
              color: 'var(--text-primary)',
            }}
          >
            Y: {drawElevation}m
          </button>
          <button
            type="button"
            disabled={drawElevation >= 24}
            onClick={() => onStepElevation(2)}
            title="Raise 2m (PageUp or ])"
            className="dcc-btn !min-h-[26px] px-2 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ border: '1px solid var(--border-strong)', backgroundColor: 'var(--bg-panel)' }}
          >
            <i className="fas fa-plus text-[10px]" />
            <span className="mono-num text-[11px]">2m</span>
          </button>
        </div>
        <div className="dcc-seg-group">
          {(
            [
              { id: 'ground', label: 'Ground' },
              { id: 'bridge', label: 'Bridge' },
              { id: 'tunnel', label: 'Tunnel' },
            ] as const
          ).map((el) => (
            <button
              key={el.id}
              type="button"
              onClick={() => onChangeElevationMode(el.id)}
              className={`dcc-seg-btn ${elevationMode === el.id ? 'active' : ''}`}
            >
              {el.label}
            </button>
          ))}
        </div>
      </div>

      {importedAssetNames.length > 0 && (
        <div className="space-y-1">
          <div className="dcc-section-title">3D Road Part</div>
          <select
            value={selectedRoadPart}
            onChange={(e) => onChangeRoadPart(e.target.value)}
            className="h-7 w-full rounded-[2px] border px-2 text-[11px] outline-none"
            style={{
              backgroundColor: 'var(--bg-panel)',
              borderColor: 'var(--border-strong)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="">Procedural Ribbon</option>
            {importedAssetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}
    </section>
  );
}
