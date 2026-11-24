import type { SimWaveResult } from './simEngine';

interface SimChartsProps {
  maxBaseHp: number;
  results: SimWaveResult[];
}

const W = 400;
const H = 152;
const PAD_L = 36;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 26;

/**
 * Clean dual SVG chart row displaying Base Survival Curve across waves
 * and per-wave Killed vs Leaked enemy breakdown.
 */
export function SimCharts({ maxBaseHp, results }: SimChartsProps) {
  const safeMaxHp = Math.max(1, maxBaseHp);
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const baselineY = PAD_T + innerH;

  const hpPoints = [
    { label: 'Start', hp: safeMaxHp },
    ...results.map((r) => ({ label: `W${r.waveNumber}`, hp: r.baseHpAfter })),
  ].map((pt, i, arr) => {
    const x = arr.length > 1 ? PAD_L + (i / (arr.length - 1)) * innerW : PAD_L + innerW * 0.5;
    const y = PAD_T + (1 - Math.max(0, Math.min(1, pt.hp / safeMaxHp))) * innerH;
    return { ...pt, x, y };
  });

  const hpPolyline = hpPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const hpArea =
    hpPoints.length > 0
      ? `M ${hpPoints[0]!.x.toFixed(1)} ${baselineY} L ${hpPoints
          .map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
          .join(' L ')} L ${hpPoints[hpPoints.length - 1]!.x.toFixed(1)} ${baselineY} Z`
      : '';

  const maxEnemies = Math.max(1, ...results.map((r) => r.totalEnemies));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* Base Survival Curve */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#14171f] p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[14px] font-semibold text-white">Base Survival Curve</span>
          <span className="mono-num text-[12px] text-[#7c8598]">Max {safeMaxHp} HP</span>
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible">
          <defs>
            <linearGradient id="simHpFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[1, 0.5, 0].map((frac) => {
            const y = PAD_T + (1 - frac) * innerH;
            return (
              <g key={frac}>
                <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#202634" strokeWidth={1} strokeDasharray={frac > 0 ? '3 3' : undefined} />
                <text x={PAD_L - 8} y={y + 3.5} textAnchor="end" fontSize="10.5" fill="#6b7485" className="mono-num">
                  {Math.round(frac * safeMaxHp)}
                </text>
              </g>
            );
          })}

          {hpArea && <path d={hpArea} fill="url(#simHpFill)" />}
          {hpPolyline && (
            <polyline fill="none" stroke="#3b82f6" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" points={hpPolyline} />
          )}

          {hpPoints.map((pt, i) => {
            const color = pt.hp <= 0 ? '#fb7185' : pt.hp < safeMaxHp ? '#fbbf24' : '#3b82f6';
            return (
              <g key={i}>
                <circle cx={pt.x} cy={pt.y} r={4} fill={color} stroke="#14171f" strokeWidth={1.75} />
                <text x={pt.x} y={H - 5} textAnchor="middle" fontSize="10.5" fill="#8b95a7" className="mono-num">
                  {pt.label}
                </text>
              </g>
            );
          })}
        </svg>
      </section>

      {/* Wave Clearance Breakdown */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#14171f] p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[14px] font-semibold text-white">Wave Clearance</span>
          <div className="flex items-center gap-3.5 text-[12px] text-[#949db0]">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#3b82f6]" />
              Killed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#fb7185]" />
              Leaked
            </span>
          </div>
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible">
          {[1, 0.5, 0].map((frac) => {
            const y = PAD_T + (1 - frac) * innerH;
            return (
              <g key={frac}>
                <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#202634" strokeWidth={1} strokeDasharray={frac > 0 ? '3 3' : undefined} />
                <text x={PAD_L - 8} y={y + 3.5} textAnchor="end" fontSize="10.5" fill="#6b7485" className="mono-num">
                  {Math.round(frac * maxEnemies)}
                </text>
              </g>
            );
          })}

          {results.map((r, i) => {
            const slotW = innerW / Math.max(1, results.length);
            const barW = Math.min(36, Math.max(12, slotW * 0.48));
            const x = PAD_L + i * slotW + (slotW - barW) * 0.5;
            const totalH = (r.totalEnemies / maxEnemies) * innerH;
            const killedH = (r.killed / maxEnemies) * innerH;
            const leakedH = (r.leaked / maxEnemies) * innerH;

            return (
              <g key={r.waveNumber}>
                <rect x={x} y={baselineY - totalH} width={barW} height={totalH} rx={4} fill="#1b202b" />
                {killedH > 0 && (
                  <rect x={x} y={baselineY - killedH} width={barW} height={killedH} rx={3} fill="#3b82f6" opacity={0.88} />
                )}
                {leakedH > 0 && (
                  <rect x={x} y={baselineY - killedH - leakedH} width={barW} height={leakedH} rx={3} fill="#fb7185" />
                )}
                <text x={x + barW * 0.5} y={baselineY - totalH - 5} textAnchor="middle" fontSize="10" fill="#a1a8b5" className="mono-num">
                  {r.leaked > 0 ? `-${r.leaked}` : r.killed}
                </text>
                <text x={x + barW * 0.5} y={H - 5} textAnchor="middle" fontSize="10.5" fill="#8b95a7" className="mono-num">
                  W{r.waveNumber}
                </text>
              </g>
            );
          })}
        </svg>
      </section>
    </div>
  );
}
