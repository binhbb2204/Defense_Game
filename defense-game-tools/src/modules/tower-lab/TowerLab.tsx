import { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TowerArchetypeConfig, TowerLevelConfig, TowerUpgradePathId } from '@tactical-td/shared';
import { ShellHeaderContext } from '../../ui/ShellHeaderContext';
import { TowerCurveChart } from './TowerCurveChart';
import { TurretPreviewCanvas } from './TurretPreviewCanvas';

interface TowerLabProps {
  towers: Record<string, TowerArchetypeConfig>;
  onChangeTower: (id: string, next: TowerArchetypeConfig) => void;
  onNotify: (type: 'ok' | 'err', text: string) => void;
}

/**
 * Modern friendly Tower Lab pairing an archetype/curve rail on the left,
 * interactive 3D turret preview in the center, and comfortable slider inspector on the right.
 */
export function TowerLab({ towers, onChangeTower, onNotify }: TowerLabProps) {
  const { rightSlot } = useContext(ShellHeaderContext);
  const towerIds = Object.keys(towers);

  const [selectedId, setSelectedId] = useState(towerIds[0] ?? 'turret');
  const [selectedLevel, setSelectedLevel] = useState(0);
  const [selectedBranch, setSelectedBranch] = useState<TowerUpgradePathId>('top');
  const [targetOrbitSpeed, setTargetOrbitSpeed] = useState(4.2);
  const [muzzleOffset, setMuzzleOffset] = useState(() =>
    (towerIds[0] ?? 'turret') === 'turret' ? { x: 0, y: 0, z: 0 } : { x: 0, y: 0.05, z: 1.55 },
  );
  const [saving, setSaving] = useState(false);

  const handleSelectArchetype = (id: string) => {
    setSelectedId(id);
    setSelectedLevel(0);
    setMuzzleOffset(id === 'turret' ? { x: 0, y: 0, z: 0 } : { x: 0, y: 0.05, z: 1.55 });
  };

  const tower = towers[selectedId];
  const baseLevelCfg = tower.levels[selectedLevel] ?? tower.levels[0];
  const hasBranches = Boolean(baseLevelCfg?.branches?.top || baseLevelCfg?.branches?.bottom);
  const levelCfg = (hasBranches ? baseLevelCfg.branches?.[selectedBranch] : undefined) ?? baseLevelCfg;

  let totalInvestedCost = tower.baseCost;
  for (let i = 1; i <= selectedLevel; i++) {
    if (i === selectedLevel && hasBranches) {
      totalInvestedCost += levelCfg.upgradeCost ?? 0;
    } else {
      totalInvestedCost += tower.levels[i]?.upgradeCost ?? 0;
    }
  }

  const updateLevelField = <K extends keyof TowerLevelConfig>(key: K, val: TowerLevelConfig[K]) => {
    const levels = [...tower.levels];
    if (hasBranches && baseLevelCfg.branches) {
      const updatedBranch: TowerLevelConfig = { ...levelCfg, [key]: val };
      const nextBranches = { ...baseLevelCfg.branches, [selectedBranch]: updatedBranch };
      levels[selectedLevel] =
        selectedBranch === 'top'
          ? { ...baseLevelCfg, [key]: val, branches: nextBranches }
          : { ...baseLevelCfg, branches: nextBranches };
    } else {
      levels[selectedLevel] = { ...levelCfg, [key]: val };
    }
    onChangeTower(selectedId, { ...tower, levels });
  };

  const handleSaveTower = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/shared/tower', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tower),
      });
      const json = (await res.json()) as { ok: boolean; filePath?: string; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || 'Save failed');
      onNotify('ok', `Saved ${json.filePath ?? `towers/${selectedId}/${selectedId}.json`}`);
    } catch (err) {
      onNotify('err', err instanceof Error ? err.message : 'Failed to save tower JSON');
    } finally {
      setSaving(false);
    }
  };

  const folderName = selectedId.charAt(0).toUpperCase() + selectedId.slice(1);

  const headerControls = (
    <div className="flex items-center gap-2">
      <span className="hidden rounded-lg border border-white/[0.08] bg-[#0e1016] px-2.5 py-1 text-[12px] text-[#8b95a7] sm:inline">
        towers/{folderName}/{selectedId}.json
      </span>
      <button
        type="button"
        disabled={saving}
        onClick={handleSaveTower}
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-[#2563eb] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#1d4ed8] disabled:opacity-50"
      >
        <span>{saving ? 'Saving...' : 'Save'}</span>
      </button>
    </div>
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#0e1015]">
      {rightSlot && createPortal(headerControls, rightSlot)}

      {/* LEFT RAIL: Archetypes + Level Curve + Muzzle Coordinates */}
      <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/[0.08] bg-[#11141b] p-4">
        <div>
          <div className="dcc-section-title mb-2">Archetypes</div>
          <div className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.08] bg-[#14171f]">
            {towerIds.map((id) => {
              const t = towers[id];
              const active = id === selectedId;
              const maxLv = t.levels[t.levels.length - 1];
              const maxDps = maxLv ? Math.round(maxLv.damage * maxLv.fireRate) : 0;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSelectArchetype(id)}
                  className={`relative w-full cursor-pointer px-3.5 py-2.5 text-left transition-colors ${
                    active ? 'bg-white/[0.07] text-white' : 'text-[#b8c0ce] hover:bg-white/[0.04]'
                  }`}
                >
                  {active && <span className="absolute top-0 bottom-0 left-0 w-[2.5px] bg-[#3b82f6]" />}
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium">{t.name}</span>
                    <span className="mono-num text-[12px] text-[#8b95a7]">${t.baseCost}</span>
                  </div>
                  <div className="mono-num mt-0.5 flex items-center justify-between text-[11.5px] text-[#707887]">
                    <span className="capitalize">{t.category}</span>
                    <span>Max {maxDps} DPS</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="dcc-section-title mb-2">Upgrade Tier</div>
          <div className="dcc-seg-group mb-3 !rounded-lg !p-1">
            {tower.levels.map((lv) => (
              <button
                key={lv.level}
                type="button"
                onClick={() => setSelectedLevel(lv.level)}
                className={`dcc-seg-btn mono-num !min-h-[30px] !rounded-md !text-[12.5px] ${
                  lv.level === selectedLevel ? 'active' : ''
                }`}
              >
                {lv.level}
              </button>
            ))}
          </div>

          {hasBranches && baseLevelCfg.branches && (
            <div className="mb-3 grid grid-cols-2 gap-1.5">
              {(['top', 'bottom'] as const).map((branchKey) => {
                const b = baseLevelCfg.branches?.[branchKey];
                if (!b) return null;
                const active = selectedBranch === branchKey;
                return (
                  <button
                    key={branchKey}
                    type="button"
                    onClick={() => setSelectedBranch(branchKey)}
                    className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                      active
                        ? branchKey === 'top'
                          ? 'border-[#22d3ee]/60 bg-[#0891b2]/20 text-[#67e8f9]'
                          : 'border-[#f59e0b]/60 bg-[#d97706]/20 text-[#fcd34d]'
                        : 'border-white/10 bg-[#14171f] text-[#94a3b8] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wider opacity-75">
                      {branchKey === 'top' ? 'Top Path' : 'Bottom Path'}
                    </div>
                    <div className="truncate text-[12px] font-semibold">{b.pathName ?? branchKey}</div>
                  </button>
                );
              })}
            </div>
          )}

          <TowerCurveChart
            baseCost={tower.baseCost}
            levels={tower.levels}
            selectedLevel={selectedLevel}
            onSelectLevel={setSelectedLevel}
          />
        </div>

        <div className="mt-auto border-t border-white/[0.07] pt-3.5">
          <div className="dcc-section-title mb-2">Muzzle Offset (m)</div>
          <div className="grid grid-cols-3 gap-2">
            {(['x', 'y', 'z'] as const).map((ax) => (
              <label
                key={ax}
                className="flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-[#0f1219] px-2.5"
              >
                <span className="text-[11px] font-semibold uppercase text-[#6b7485]">{ax}</span>
                <input
                  type="number"
                  step={0.05}
                  value={muzzleOffset[ax]}
                  onChange={(e) => setMuzzleOffset({ ...muzzleOffset, [ax]: Number(e.target.value) || 0 })}
                  className="mono-num w-full min-w-0 bg-transparent text-right text-[12.5px] font-medium text-white outline-none"
                />
              </label>
            ))}
          </div>
        </div>
      </aside>

      {/* CENTER: Live 3D Turret Stage */}
      <TurretPreviewCanvas
        towerId={selectedId}
        towerName={tower.name}
        towerModelPath={tower.modelPath}
        category={tower.category}
        totalInvestedCost={totalInvestedCost}
        levelCfg={levelCfg}
        targetOrbitSpeed={targetOrbitSpeed}
        muzzleOffset={muzzleOffset}
        onChangeOrbitSpeed={setTargetOrbitSpeed}
      />

      {/* RIGHT INSPECTOR: Grouped Parameter Sliders */}
      <aside className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-white/[0.08] bg-[#14171f] p-4">
        <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
          <span className="text-[14px] font-semibold text-white">
            Level {levelCfg.level}
            {levelCfg.pathName ? ` · ${levelCfg.pathName}` : ''} Parameters
          </span>
          <span className="mono-num text-[12px] text-[#8b95a7]">Invested ${totalInvestedCost}</span>
        </div>

        <InspectorSection title="Combat">
          <StatSliderRow
            label="Damage / Shot"
            value={levelCfg.damage}
            min={1}
            max={400}
            step={1}
            onChange={(v) => updateLevelField('damage', v)}
          />
          <StatSliderRow
            label="Fire Rate (shots/s)"
            value={levelCfg.fireRate}
            min={0.1}
            max={14}
            step={0.05}
            onChange={(v) => updateLevelField('fireRate', v)}
          />
          <StatSliderRow
            label="Range (m)"
            value={levelCfg.range}
            min={4}
            max={45}
            step={0.5}
            onChange={(v) => updateLevelField('range', v)}
          />
        </InspectorSection>

        <InspectorSection title="Kinematics">
          <StatSliderRow
            label="Turn Speed (rad/s)"
            value={levelCfg.turnSpeedRad}
            min={0.4}
            max={14}
            step={0.2}
            onChange={(v) => updateLevelField('turnSpeedRad', v)}
          />
          <StatSliderRow
            label="Projectile Speed (m/s)"
            value={levelCfg.projectileSpeed}
            min={6}
            max={200}
            step={1}
            onChange={(v) => updateLevelField('projectileSpeed', v)}
          />
        </InspectorSection>

        <InspectorSection title="Targeting & Traits">
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                { key: 'detectHidden', label: 'Hidden' },
                { key: 'pierceLead', label: 'Lead' },
                { key: 'hitFlying', label: 'Flying' },
              ] as const
            ).map(({ key, label }) => {
              const active = Boolean(levelCfg[key]);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => updateLevelField(key, !active)}
                  className={`cursor-pointer rounded-lg border px-2 py-1.5 text-[11.5px] font-semibold transition-colors ${
                    active
                      ? 'border-[#3b82f6]/60 bg-[#2563eb]/20 text-[#93c5fd]'
                      : 'border-white/10 bg-[#0f1219] text-[#6b7485] hover:text-[#a1a8b5]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <StatSliderRow
            label="Armor Pen"
            value={levelCfg.armorPen ?? 0}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => updateLevelField('armorPen', v)}
          />
          <div>
            <div className="mb-1 text-[11.5px] text-[#a1a8b5]">Model (.glb)</div>
            <input
              type="text"
              value={levelCfg.modelPath ?? tower.modelPath ?? ''}
              onChange={(e) => updateLevelField('modelPath', e.target.value)}
              className="mono-num h-8 w-full rounded-lg border border-white/10 bg-[#0f1219] px-2.5 text-[11.5px] text-white outline-none focus:border-[#3b82f6]"
            />
          </div>
        </InspectorSection>

        <InspectorSection title="Economy">
          <StatSliderRow
            label="Upgrade Cost ($)"
            value={levelCfg.upgradeCost}
            min={0}
            max={2500}
            step={10}
            onChange={(v) => updateLevelField('upgradeCost', v)}
          />
        </InspectorSection>

        {tower.category === 'explosive' && (
          <InspectorSection title="Explosive">
            <StatSliderRow
              label="Shockwave Radius (m)"
              value={levelCfg.splashRadius ?? 4}
              min={1}
              max={12}
              step={0.2}
              onChange={(v) => updateLevelField('splashRadius', v)}
            />
            <StatSliderRow
              label="Friendly Stun (s)"
              value={levelCfg.friendlyStunDuration ?? 1.2}
              min={0}
              max={4}
              step={0.1}
              onChange={(v) => updateLevelField('friendlyStunDuration', v)}
            />
          </InspectorSection>
        )}
      </aside>
    </div>
  );
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-white/[0.07] pb-4 last:border-b-0">
      <div className="dcc-section-title !text-[11.5px]">{title}</div>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

function StatSliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="text-[#a1a8b5]">{label}</span>
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="mono-num h-8 w-20 rounded-lg border border-white/10 bg-[#0f1219] px-2.5 text-right text-[12.5px] font-medium text-white outline-none focus:border-[#3b82f6]"
        />
      </div>
      <input
        type="range"
        min={min}
        max={Math.max(max, value)}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="dcc-slider mt-2"
      />
    </div>
  );
}
