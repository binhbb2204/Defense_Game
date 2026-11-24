import type { ElevatedZone, MapCustomModel, MapObstacle } from '@tactical-td/shared';
import type { CustomPropValue } from '../../types';
import { CustomAttributesEditor, SectionHeader, Vec3InputRow } from './InspectorPrimitives';

export function PropEntityInspector({
  obs,
  zone,
  mdl,
  onUpdateObstacle,
  onUpdateZone,
  onUpdateCustomModel,
  onDelete,
}: {
  obs?: MapObstacle;
  zone?: ElevatedZone;
  mdl?: MapCustomModel;
  onUpdateObstacle: (id: string, patch: Partial<MapObstacle>) => void;
  onUpdateZone: (id: string, patch: Partial<ElevatedZone>) => void;
  onUpdateCustomModel: (id: string, patch: Partial<MapCustomModel>) => void;
  onDelete: () => void;
}) {
  if (!obs && !zone && !mdl) return null;

  const customProps =
    obs?.customProperties ?? zone?.customProperties ?? mdl?.customProperties ?? {};
  const setCustomProps = (next: Record<string, CustomPropValue>) => {
    if (obs) onUpdateObstacle(obs.id, { customProperties: next });
    else if (zone) onUpdateZone(zone.id, { customProperties: next });
    else if (mdl) onUpdateCustomModel(mdl.id, { customProperties: next });
  };

  const pos = obs?.position ?? zone?.position ?? mdl!.position;
  const rotDeg = Math.round(((obs?.rotationY ?? zone?.rotationY ?? mdl!.rotationY) * 180) / Math.PI);
  const dims = obs?.size ?? zone?.size ?? mdl!.scale;

  return (
    <div className="space-y-1.5 p-2">
      <SectionHeader
        title={obs ? `Prop: ${obs.kind}` : zone ? `Platform: ${zone.kind}` : `3D Asset: ${mdl!.format}`}
      />
      {obs && (
        <div className="prop-row">
          <div className="prop-name">ID</div>
          <div className="prop-value mono-num text-[11px]">{obs.id}</div>
        </div>
      )}
      {zone && (
        <div className="prop-row">
          <div className="prop-name">Label</div>
          <div className="prop-value">
            <input
              type="text"
              value={zone.label}
              onChange={(e) => onUpdateZone(zone.id, { label: e.target.value })}
            />
          </div>
        </div>
      )}
      {mdl && (
        <div className="prop-row">
          <div className="prop-name">Name</div>
          <div className="prop-value">
            <input
              type="text"
              value={mdl.name}
              onChange={(e) => onUpdateCustomModel(mdl.id, { name: e.target.value })}
            />
          </div>
        </div>
      )}

      <Vec3InputRow
        label="Position"
        value={pos}
        onChange={(v) => {
          if (obs) onUpdateObstacle(obs.id, { position: v });
          else if (zone) onUpdateZone(zone.id, { position: v });
          else if (mdl) onUpdateCustomModel(mdl.id, { position: v });
        }}
      />

      <div className="prop-row">
        <div className="prop-name">Rot Y (deg)</div>
        <div className="prop-value">
          <input
            type="number"
            step={5}
            value={rotDeg}
            onChange={(e) => {
              const rad = ((Number(e.target.value) || 0) * Math.PI) / 180;
              if (obs) onUpdateObstacle(obs.id, { rotationY: rad });
              else if (zone) onUpdateZone(zone.id, { rotationY: rad });
              else if (mdl) onUpdateCustomModel(mdl.id, { rotationY: rad });
            }}
          />
        </div>
      </div>

      <Vec3InputRow
        label={mdl ? 'Scale' : 'Size'}
        value={dims}
        step={mdl ? 0.1 : 0.5}
        onChange={(v) => {
          const clamped = {
            x: Math.max(0.1, v.x),
            y: Math.max(0.1, v.y),
            z: Math.max(0.1, v.z),
          };
          if (obs) onUpdateObstacle(obs.id, { size: clamped });
          else if (zone) onUpdateZone(zone.id, { size: clamped });
          else if (mdl) onUpdateCustomModel(mdl.id, { scale: clamped });
        }}
      />

      {(obs || mdl) && (
        <>
          <div className="prop-row">
            <div className="prop-name">Blocks LoS</div>
            <div className="prop-value">
              <input
                type="checkbox"
                checked={obs ? obs.blocksLoS : Boolean(mdl?.blocksLoS)}
                onChange={(e) => {
                  if (obs) onUpdateObstacle(obs.id, { blocksLoS: e.target.checked });
                  else if (mdl) onUpdateCustomModel(mdl.id, { blocksLoS: e.target.checked });
                }}
              />
            </div>
          </div>
          <div className="prop-row">
            <div className="prop-name">Color</div>
            <div className="prop-value">
              <input
                type="color"
                value={obs?.color ?? mdl?.color ?? '#64748b'}
                onChange={(e) => {
                  if (obs) onUpdateObstacle(obs.id, { color: e.target.value });
                  else if (mdl) onUpdateCustomModel(mdl.id, { color: e.target.value });
                }}
                className="h-5 w-8 cursor-pointer bg-transparent"
              />
            </div>
          </div>
        </>
      )}

      {mdl && (
        <div className="prop-row">
          <div className="prop-name">High Ground</div>
          <div className="prop-value">
            <input
              type="checkbox"
              checked={Boolean(mdl.isHighGround)}
              onChange={(e) => onUpdateCustomModel(mdl.id, { isHighGround: e.target.checked })}
            />
          </div>
        </div>
      )}

      <CustomAttributesEditor customProps={customProps} onChange={setCustomProps} />

      <button
        type="button"
        onClick={onDelete}
        className="mt-1 w-full cursor-pointer rounded-[4px] border px-2 py-1 text-[11px] font-medium"
        style={{
          backgroundColor: 'rgba(239, 68, 68, 0.14)',
          borderColor: 'var(--semantic-error)',
          color: '#fca5a5',
        }}
      >
        <i className="fas fa-trash-alt mr-1.5" />
        Delete Prop (Del)
      </button>
    </div>
  );
}
