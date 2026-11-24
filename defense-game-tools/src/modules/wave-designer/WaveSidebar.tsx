import type { WaveDefinition } from '@tactical-td/shared';
import { ENEMY_META, type WaveWithCampaignStats } from './waveMetrics';

interface WaveSidebarProps {
  waves: WaveDefinition[];
  statsList: WaveWithCampaignStats[];
  selectedIdx: number;
  onSelectWave: (idx: number) => void;
  onAddWave: () => void;
  onDuplicateWave: (idx: number) => void;
}

/**
 * Friendly left navigation rail for Wave Designer featuring an interactive EHP pacing
 * sparkline and spacious rounded wave cards with enemy-mix composition strips.
 */
export function WaveSidebar({
  waves,
  statsList,
  selectedIdx,
  onSelectWave,
  onAddWave,
  onDuplicateWave,
}: WaveSidebarProps) {
  const maxEhp = Math.max(1, ...statsList.map((s) => s.effectiveHp));

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-white/[0.08] bg-[#11141b]">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-white">Waves</span>
          <span className="mono-num rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] font-medium text-[#949db0]">
            {waves.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onAddWave}
          className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-[12.5px] font-medium text-[#e5e7eb] transition-colors hover:border-[#2563eb] hover:bg-[#2563eb] hover:text-white"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
            <path d="M6 2.5v7M2.5 6h7" />
          </svg>
          <span>New</span>
        </button>
      </div>

      {/* Mini Campaign Difficulty Sparkline */}
      <div className="border-b border-white/[0.07] px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-[11.5px]">
          <span className="font-semibold uppercase tracking-[0.05em] text-[#7c8598]">EHP Curve</span>
          <span className="mono-num text-[#8b95a7]">Peak {maxEhp.toLocaleString()}</span>
        </div>
        <div className="flex h-14 items-end gap-1.5 rounded-xl bg-[#0c0e14] p-2">
          {waves.map((w, idx) => {
            const st = statsList[idx];
            const ratio = Math.max(0.14, st.effectiveHp / maxEhp);
            const active = idx === selectedIdx;
            return (
              <button
                key={w.waveNumber}
                type="button"
                onClick={() => onSelectWave(idx)}
                title={`Wave ${w.waveNumber}: ${st.effectiveHp.toLocaleString()} EHP`}
                className="flex h-full flex-1 cursor-pointer items-end"
              >
                <span
                  className="w-full rounded-sm transition-colors"
                  style={{
                    height: `${Math.round(ratio * 100)}%`,
                    backgroundColor: active ? '#3b82f6' : '#2a3140',
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Rounded Wave Cards */}
      <div className="flex-1 space-y-1 overflow-y-auto p-2.5">
        {waves.map((w, idx) => {
          const st = statsList[idx];
          const active = idx === selectedIdx;
          return (
            <div
              key={w.waveNumber}
              role="button"
              tabIndex={0}
              onClick={() => onSelectWave(idx)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectWave(idx);
                }
              }}
              className={`group relative cursor-pointer rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                active
                  ? 'border-white/10 bg-white/[0.07]'
                  : 'border-transparent hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="mono-num shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold"
                    style={{
                      backgroundColor: active ? 'rgba(59, 130, 246, 0.22)' : 'rgba(255, 255, 255, 0.06)',
                      color: active ? '#93c5fd' : '#8b95a7',
                    }}
                  >
                    W{w.waveNumber}
                  </span>
                  <span className={`truncate text-[13px] font-medium ${active ? 'text-white' : 'text-[#cbd5e1]'}`}>
                    {w.name}
                  </span>
                </div>

                <button
                  type="button"
                  title="Duplicate wave"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicateWave(idx);
                  }}
                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-[#8b95a7] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/[0.08] hover:text-white"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
                    <path d="M2.5 8H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v.5" />
                  </svg>
                </button>
              </div>

              <div className="mono-num mt-1.5 flex items-center justify-between text-[12px] text-[#8b95a7]">
                <span>{st.totalCount} hostiles</span>
                <span>{st.effectiveHp.toLocaleString()} EHP</span>
              </div>

              {/* Stacked Enemy Composition Bar */}
              <div className="mt-2.5 flex h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                {st.shares.map((s) => (
                  <span
                    key={s.type}
                    style={{ width: `${s.pct}%`, backgroundColor: ENEMY_META[s.type].dot }}
                    title={`${ENEMY_META[s.type].short}: ${s.count}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
