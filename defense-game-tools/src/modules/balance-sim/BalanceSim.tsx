import { useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MapDefinition, TowerArchetypeConfig, WaveDefinition } from '@tactical-td/shared';
import { ShellHeaderContext } from '../../ui/ShellHeaderContext';
import { SimCharts } from './SimCharts';
import { runHeadlessSim, type SquadSlot } from './simEngine';
import { SquadBuilderSidebar } from './SquadBuilderSidebar';

interface BalanceSimProps {
  map: MapDefinition;
  waves: WaveDefinition[];
  towers: Record<string, TowerArchetypeConfig>;
}

/**
 * Modern friendly headless 60Hz Balance Simulator pairing a squad builder rail
 * with SVG survival & clearance curves and a crisp rounded results table.
 */
export function BalanceSim({ map, waves, towers }: BalanceSimProps) {
  const { rightSlot } = useContext(ShellHeaderContext);
  const [squad, setSquad] = useState<SquadSlot[]>([
    { towerId: 'turret', count: 3, level: 2 },
    { towerId: 'sniper', count: 2, level: 2 },
    { towerId: 'mortar', count: 1, level: 1 },
  ]);
  const [losUptimePct, setLosUptimePct] = useState(78);
  const [stunPenaltyPct, setStunPenaltyPct] = useState(10);

  const sim = useMemo(
    () => runHeadlessSim(map, waves, towers, squad, losUptimePct, stunPenaltyPct),
    [map, waves, towers, squad, losUptimePct, stunPenaltyPct],
  );

  const finalHp = sim.results[sim.results.length - 1]?.baseHpAfter ?? map.baseHp;
  const allCleared = sim.breachedWave === null && finalHp > 0;
  const overBudget = sim.squadCost > sim.totalCampaignCash;

  const headerBadge = (
    <span className="rounded-lg border border-white/[0.08] bg-[#0e1016] px-3 py-1 text-[12px] text-[#949db0]">
      {map.name} · {Math.round(sim.pathLength)}m route
    </span>
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#0e1015]">
      {rightSlot && createPortal(headerBadge, rightSlot)}

      <SquadBuilderSidebar
        towers={towers}
        squad={squad}
        losUptimePct={losUptimePct}
        stunPenaltyPct={stunPenaltyPct}
        onChangeSquad={setSquad}
        onChangeLosUptime={setLosUptimePct}
        onChangeStunPenalty={setStunPenaltyPct}
      />

      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[1160px] space-y-6">
          {/* Calm Verdict Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#14171f] px-5 py-4">
            <div className="flex items-center gap-3">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: allCleared ? '#4ade80' : '#fb7185' }}
              />
              <span className="text-[15px] font-semibold text-white">
                {allCleared
                  ? `All ${waves.length} waves cleared with ${finalHp} Base HP`
                  : `Defense breached on Wave ${sim.breachedWave}`}
              </span>
            </div>

            <span
              className={`mono-num rounded-full border px-3 py-1 text-[12px] font-medium ${
                overBudget
                  ? 'border-[#eab308]/40 bg-[#eab308]/10 text-[#fde047]'
                  : 'border-white/[0.08] bg-[#0e1016] text-[#949db0]'
              }`}
            >
              Squad ${sim.squadCost.toLocaleString()} of ${sim.totalCampaignCash.toLocaleString()} earned
            </span>
          </div>

          {/* Unified Soft Rounded 4-Metric Strip */}
          <div className="grid grid-cols-2 divide-y divide-white/[0.07] rounded-2xl border border-white/[0.08] bg-[#14171f] md:grid-cols-4 md:divide-x md:divide-y-0">
            <div className="px-5 py-4">
              <div className="text-[12px] font-medium text-[#8b95a7]">Squad Cost</div>
              <div className="mono-num mt-1 text-[24px] font-semibold tracking-[-0.02em] text-white">
                ${sim.squadCost.toLocaleString()}
              </div>
              <div className="mono-num mt-1 text-[12px] text-[#6b7485]">
                {squad.reduce((acc, s) => acc + s.count, 0)} towers deployed
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="text-[12px] font-medium text-[#8b95a7]">Effective DPS</div>
              <div className="mono-num mt-1 text-[24px] font-semibold tracking-[-0.02em] text-[#93c5fd]">
                {sim.effectiveDps.toLocaleString()}
              </div>
              <div className="mono-num mt-1 text-[12px] text-[#6b7485]">
                Raw {sim.rawDps.toLocaleString()} DPS
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="text-[12px] font-medium text-[#8b95a7]">Final Base HP</div>
              <div
                className="mono-num mt-1 text-[24px] font-semibold tracking-[-0.02em]"
                style={{ color: finalHp > 0 ? '#ffffff' : '#fb7185' }}
              >
                {finalHp} <span className="text-[14px] font-normal text-[#707887]">/ {map.baseHp}</span>
              </div>
              <div className="mono-num mt-1 text-[12px] text-[#6b7485]">
                {Math.round((finalHp / Math.max(1, map.baseHp)) * 100)}% integrity
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="text-[12px] font-medium text-[#8b95a7]">Total Sim Time</div>
              <div className="mono-num mt-1 text-[24px] font-semibold tracking-[-0.02em] text-white">
                {sim.totalSimTimeSec}s
              </div>
              <div className="mono-num mt-1 text-[12px] text-[#6b7485]">60Hz headless sim</div>
            </div>
          </div>

          <SimCharts maxBaseHp={map.baseHp} results={sim.results} />

          {/* Clean Hairline Wave Table */}
          <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#14171f]">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead className="border-b border-white/[0.07] bg-[#11141b] text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#7c8598]">
                <tr>
                  <th className="px-5 py-3">Wave</th>
                  <th className="px-5 py-3">Enemies</th>
                  <th className="px-5 py-3">Killed</th>
                  <th className="px-5 py-3">Leaked</th>
                  <th className="px-5 py-3">Sim Time</th>
                  <th className="px-5 py-3">Base HP</th>
                  <th className="px-5 py-3 text-right">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {sim.results.map((r) => {
                  const hpPct = Math.max(0, Math.min(100, (r.baseHpAfter / Math.max(1, map.baseHp)) * 100));
                  const ok = r.status === 'CLEARED';
                  return (
                    <tr key={r.waveNumber} className="transition-colors hover:bg-white/[0.03]">
                      <td className="px-5 py-3 font-medium text-white">
                        <span className="mono-num mr-2 text-[#7c8598]">W{r.waveNumber}</span>
                        <span>{r.waveName}</span>
                      </td>
                      <td className="mono-num px-5 py-3 text-[#d1d6e0]">{r.totalEnemies}</td>
                      <td className="mono-num px-5 py-3 text-[#93c5fd]">{r.killed}</td>
                      <td className="mono-num px-5 py-3" style={{ color: r.leaked > 0 ? '#fda4af' : '#707887' }}>
                        {r.leaked}
                      </td>
                      <td className="mono-num px-5 py-3 text-[#8b95a7]">{r.durationSec}s</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="mono-num w-9 text-[#eef1f6]">{r.baseHpAfter}</span>
                          <span className="h-2 w-20 overflow-hidden rounded-full bg-white/[0.08]">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${hpPct}%`,
                                backgroundColor: r.baseHpAfter > 0 ? '#3b82f6' : '#fb7185',
                              }}
                            />
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium"
                          style={{
                            backgroundColor: ok ? 'rgba(74, 222, 128, 0.12)' : 'rgba(251, 113, 133, 0.12)',
                            color: ok ? '#86efac' : '#fda4af',
                          }}
                        >
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ok ? '#4ade80' : '#fb7185' }} />
                          <span>{ok ? 'Cleared' : 'Breached'}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      </main>
    </div>
  );
}
