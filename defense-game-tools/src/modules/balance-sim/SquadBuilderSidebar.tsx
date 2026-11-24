import type { TowerArchetypeConfig } from '@tactical-td/shared';
import type { SquadSlot } from './simEngine';

interface SquadBuilderSidebarProps {
  towers: Record<string, TowerArchetypeConfig>;
  squad: SquadSlot[];
  losUptimePct: number;
  stunPenaltyPct: number;
  onChangeSquad: (next: SquadSlot[]) => void;
  onChangeLosUptime: (pct: number) => void;
  onChangeStunPenalty: (pct: number) => void;
}

function buildPreset(
  preset: 'starter' | 'balanced' | 'late',
  towerIds: string[],
): SquadSlot[] {
  const pick = (preferred: string, fallbackIdx: number) =>
    towerIds.includes(preferred) ? preferred : towerIds[fallbackIdx % Math.max(1, towerIds.length)] ?? preferred;

  if (preset === 'starter') {
    return [
      { towerId: pick('turret', 0), count: 2, level: 0 },
      { towerId: pick('sniper', 1), count: 1, level: 0 },
    ];
  }
  if (preset === 'balanced') {
    return [
      { towerId: pick('turret', 0), count: 3, level: 2 },
      { towerId: pick('sniper', 1), count: 2, level: 2 },
      { towerId: pick('mortar', 2), count: 1, level: 1 },
    ];
  }
  return [
    { towerId: pick('turret', 0), count: 4, level: 4 },
    { towerId: pick('sniper', 1), count: 3, level: 5 },
    { towerId: pick('mortar', 2), count: 2, level: 4 },
  ];
}

/**
 * Comfortable left rail for assembling test tower squads (presets, count steppers, Lv 0-5 pills)
 * and tuning battlefield LoS / stun conditions.
 */
export function SquadBuilderSidebar({
  towers,
  squad,
  losUptimePct,
  stunPenaltyPct,
  onChangeSquad,
  onChangeLosUptime,
  onChangeStunPenalty,
}: SquadBuilderSidebarProps) {
  const towerIds = Object.keys(towers);

  const updateSlot = (idx: number, patch: Partial<SquadSlot>) => {
    const next = [...squad];
    next[idx] = { ...next[idx]!, ...patch };
    onChangeSquad(next);
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-white/[0.08] bg-[#11141b]">
      <div className="border-b border-white/[0.07] p-4">
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-semibold text-white">Defense Squad</span>
          <button
            type="button"
            onClick={() => onChangeSquad([...squad, { towerId: towerIds[0] ?? 'turret', count: 1, level: 0 }])}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-[12.5px] font-medium text-[#e5e7eb] transition-colors hover:border-[#2563eb] hover:bg-[#2563eb] hover:text-white"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <path d="M6 2.5v7M2.5 6h7" />
            </svg>
            <span>Add Tower</span>
          </button>
        </div>

        <div className="dcc-seg-group mt-3 !rounded-lg !p-1">
          {(
            [
              ['starter', 'Starter'],
              ['balanced', 'Balanced'],
              ['late', 'Late Game'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onChangeSquad(buildPreset(id, towerIds))}
              className="dcc-seg-btn !min-h-[30px] !rounded-md !text-[12px]"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Squad Slots */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {squad.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-[12.5px] text-[#707887]">
            Add a tower or choose a preset above.
          </div>
        ) : (
          squad.map((slot, idx) => {
            const cfg = towers[slot.towerId];
            const lv = cfg?.levels[slot.level] ?? cfg?.levels[0];
            let unitCost = cfg?.baseCost ?? 0;
            for (let l = 1; l <= slot.level; l++) unitCost += cfg?.levels[l]?.upgradeCost ?? 0;
            const slotCost = unitCost * slot.count;
            const slotDps = lv ? Math.round(lv.damage * lv.fireRate * slot.count) : 0;

            return (
              <div key={idx} className="rounded-xl border border-white/[0.08] bg-[#161a23] p-3">
                <div className="flex items-center gap-2">
                  <select
                    value={slot.towerId}
                    onChange={(e) => updateSlot(idx, { towerId: e.target.value })}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0e1016] px-2.5 text-[13px] font-medium text-white outline-none focus:border-[#3b82f6]"
                  >
                    {towerIds.map((id) => (
                      <option key={id} value={id}>
                        {towers[id]!.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    title="Remove tower slot"
                    onClick={() => onChangeSquad(squad.filter((_, i) => i !== idx))}
                    className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[#8b95a7] hover:bg-[#2a1a1f] hover:text-[#fda4af]"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                      <path d="M2.5 2.5 9.5 9.5M9.5 2.5l-7 7" />
                    </svg>
                  </button>
                </div>

                <div className="mono-num mt-1.5 flex items-center justify-between text-[11.5px] text-[#8b95a7]">
                  <span>Cost ${slotCost.toLocaleString()}</span>
                  <span>{slotDps} DPS</span>
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-2">
                  {/* Tactile Count Stepper */}
                  <div className="flex h-8 items-center overflow-hidden rounded-lg border border-white/10 bg-[#0e1016]">
                    <button
                      type="button"
                      onClick={() => updateSlot(idx, { count: Math.max(0, slot.count - 1) })}
                      className="flex h-full w-8 cursor-pointer items-center justify-center border-r border-white/[0.08] text-sm text-[#949db0] hover:bg-white/[0.06] hover:text-white"
                    >
                      −
                    </button>
                    <span className="mono-num w-8 text-center text-[12.5px] font-semibold text-white">
                      {slot.count}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateSlot(idx, { count: Math.min(30, slot.count + 1) })}
                      className="flex h-full w-8 cursor-pointer items-center justify-center border-l border-white/[0.08] text-sm text-[#949db0] hover:bg-white/[0.06] hover:text-white"
                    >
                      +
                    </button>
                  </div>

                  {/* Level 0-5 Pill Selector */}
                  <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-[#0e1016] p-0.5">
                    {[0, 1, 2, 3, 4, 5].map((lvNum) => (
                      <button
                        key={lvNum}
                        type="button"
                        onClick={() => updateSlot(idx, { level: lvNum })}
                        className={`mono-num h-7 w-7 cursor-pointer rounded-md text-[11.5px] font-medium transition-colors ${
                          slot.level === lvNum
                            ? 'bg-[#2563eb] text-white'
                            : 'text-[#7c8598] hover:bg-white/[0.06] hover:text-white'
                        }`}
                      >
                        {lvNum}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Battlefield Conditions */}
      <div className="space-y-3.5 border-t border-white/[0.07] p-4">
        <div className="dcc-section-title">Field Conditions</div>

        <div>
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="text-[#a1a8b5]">Line-of-Sight Uptime</span>
            <span className="mono-num font-semibold text-white">{losUptimePct}%</span>
          </div>
          <input
            type="range"
            min={25}
            max={100}
            value={losUptimePct}
            onChange={(e) => onChangeLosUptime(Number(e.target.value))}
            className="dcc-slider mt-2"
          />
          <p className="mt-1.5 text-[11.5px] text-[#6b7485]">
            Share of path visible around obstacles and tunnels.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="text-[#a1a8b5]">Friendly Stun Downtime</span>
            <span className="mono-num font-semibold text-white">{stunPenaltyPct}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={40}
            value={stunPenaltyPct}
            onChange={(e) => onChangeStunPenalty(Number(e.target.value))}
            className="dcc-slider mt-2"
          />
          <p className="mt-1.5 text-[11.5px] text-[#6b7485]">
            Firing time lost to explosive shockwaves.
          </p>
        </div>
      </div>
    </aside>
  );
}
