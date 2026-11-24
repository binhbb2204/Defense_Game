import { useState } from 'react';
import type { TowerLevelConfig } from '@tactical-td/shared';

interface TowerCurveChartProps {
  baseCost: number;
  levels: TowerLevelConfig[];
  selectedLevel: number;
  onSelectLevel: (level: number) => void;
}

const W = 220;
const H = 92;
const PAD_X = 14;
const PAD_TOP = 12;
const PAD_BOTTOM = 18;

/**
 * Interactive SVG progression curve showing DPS across Lv 0..5.
 * Clicking any node selects that upgrade tier.
 */
export function TowerCurveChart({
  baseCost,
  levels,
  selectedLevel,
  onSelectLevel,
}: TowerCurveChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  if (levels.length === 0) return null;

  const dpsList = levels.map((lv) => lv.damage * lv.fireRate);
  const maxDps = Math.max(1, ...dpsList);
  const costs: number[] = [];
  let runningCost = baseCost;
  for (let i = 0; i < levels.length; i++) {
    if (i > 0) runningCost += levels[i]!.upgradeCost;
    costs.push(runningCost);
  }

  const pts = levels.map((lv, i) => {
    const x = levels.length > 1 ? PAD_X + (i / (levels.length - 1)) * (W - PAD_X * 2) : W * 0.5;
    const y = PAD_TOP + (1 - (lv.damage * lv.fireRate) / maxDps) * (H - PAD_TOP - PAD_BOTTOM);
    return { x, y, lv, dps: lv.damage * lv.fireRate, cost: costs[i]! };
  });

  const polyline = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const baseLineY = H - PAD_BOTTOM;
  const areaPath = `M ${pts[0]!.x.toFixed(1)} ${baseLineY} L ${pts
    .map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' L ')} L ${pts[pts.length - 1]!.x.toFixed(1)} ${baseLineY} Z`;

  const inspectIdx = hoveredIdx ?? selectedLevel;
  const inspectPt = pts[inspectIdx] ?? pts[0]!;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0e1016] p-3">
      <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
        <span className="font-semibold uppercase tracking-[0.05em] text-[#7c8598]">DPS Curve</span>
        <span className="mono-num font-medium text-[#d1d6e0]">
          Lv.{inspectPt.lv.level}: {inspectPt.dps.toFixed(0)} · ${inspectPt.cost}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible">
        <defs>
          <linearGradient id="towerDpsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>

        <line x1={PAD_X} y1={PAD_TOP} x2={W - PAD_X} y2={PAD_TOP} stroke="#1a1f29" strokeWidth={0.9} />
        <line x1={PAD_X} y1={(PAD_TOP + baseLineY) * 0.5} x2={W - PAD_X} y2={(PAD_TOP + baseLineY) * 0.5} stroke="#1a1f29" strokeWidth={0.9} />
        <line x1={PAD_X} y1={baseLineY} x2={W - PAD_X} y2={baseLineY} stroke="#232936" strokeWidth={1} />

        <path d={areaPath} fill="url(#towerDpsFill)" />
        <polyline
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={polyline}
        />

        {pts.map((p, i) => {
          const active = i === selectedLevel;
          return (
            <g
              key={p.lv.level}
              onClick={() => onSelectLevel(p.lv.level)}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="cursor-pointer"
            >
              <circle cx={p.x} cy={p.y} r={10} fill="transparent" />
              {active && <circle cx={p.x} cy={p.y} r={6.5} fill="#3b82f6" opacity={0.28} />}
              <circle
                cx={p.x}
                cy={p.y}
                r={active ? 3.8 : 2.7}
                fill={active ? '#ffffff' : '#60a5fa'}
                stroke="#2563eb"
                strokeWidth={1.35}
              />
              <text
                x={p.x}
                y={H - 3}
                textAnchor="middle"
                fontSize="10"
                fill={active ? '#eef1f6' : '#6b7485'}
                className="mono-num"
              >
                L{p.lv.level}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
