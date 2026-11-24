import { useEffect, useRef, useState } from 'react';
import {
  ENEMY_CONFIGS,
  type WaveDefinition,
  type WaveSpawnGroup,
  type ZombieTypeId,
} from '@tactical-td/shared';
import { ENEMY_META, ZOMBIE_TYPES } from './waveMetrics';

interface WaveTimelineStageProps {
  wave: WaveDefinition;
  timelineMax: number;
  selectedGroupIdx: number;
  onSelectGroup: (idx: number) => void;
  onUpdateGroup: (idx: number, patch: Partial<WaveSpawnGroup>) => void;
  onAddGroup: () => void;
  onDuplicateGroup: (idx: number) => void;
  onRemoveGroup: (idx: number) => void;
}

/**
 * Interactive DAW-style spawn pacing stage with rounded timeline clips, horizontal drag-to-delay,
 * animated playhead preview, and a comfortable focused group inspector.
 */
export function WaveTimelineStage({
  wave,
  timelineMax,
  selectedGroupIdx,
  onSelectGroup,
  onUpdateGroup,
  onAddGroup,
  onDuplicateGroup,
  onRemoveGroup,
}: WaveTimelineStageProps) {
  const [playing, setPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const tracksRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing) return;
    let rafId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) * 0.001, 0.05);
      last = now;
      setPlayheadSec((prev) => {
        const next = prev + dt;
        return next >= timelineMax ? 0 : next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, timelineMax]);

  const safeGroupIdx = Math.min(selectedGroupIdx, Math.max(0, wave.groups.length - 1));
  const activeGroup = wave.groups[safeGroupIdx];
  const activeEnemyCfg = activeGroup ? ENEMY_CONFIGS[activeGroup.zombieType] : null;

  const tickStep = timelineMax > 40 ? 10 : timelineMax > 20 ? 5 : 2;
  const ticks: number[] = [];
  for (let s = 0; s <= timelineMax; s += tickStep) ticks.push(s);

  const startDragDelay = (groupIdx: number, origDelay: number, e: React.MouseEvent) => {
    e.preventDefault();
    onSelectGroup(groupIdx);
    const laneEl = tracksRef.current;
    if (!laneEl) return;
    const laneWidth = Math.max(120, laneEl.getBoundingClientRect().width);
    const startX = e.clientX;

    const onMove = (ev: MouseEvent) => {
      const deltaSec = ((ev.clientX - startX) / laneWidth) * timelineMax;
      const snapped = Math.max(0, Math.round((origDelay + deltaSec) * 4) / 4);
      onUpdateGroup(groupIdx, { startDelay: Number(snapped.toFixed(2)) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="space-y-5">
      {/* Timeline Panel */}
      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#14171f]">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="text-[14px] font-semibold text-white">Spawn Pacing</span>
            <span className="mono-num text-[12.5px] text-[#7c8598]">0s – {timelineMax.toFixed(0)}s</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (playing) setPlaying(false);
                else {
                  setPlayheadSec(0);
                  setPlaying(true);
                }
              }}
              className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors ${
                playing
                  ? 'border-[#3b82f6] bg-[#1a2947] text-white'
                  : 'border-white/10 bg-white/[0.05] text-[#d1d6e0] hover:bg-white/[0.09] hover:text-white'
              }`}
            >
              {playing ? (
                <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="currentColor">
                  <rect x="2.5" y="2.5" width="7" height="7" rx="1.2" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M3.2 2.2 9.8 6l-6.6 3.8V2.2Z" />
                </svg>
              )}
              <span className="mono-num">{playing ? `${playheadSec.toFixed(1)}s` : 'Preview'}</span>
            </button>

            <button
              type="button"
              onClick={onAddGroup}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-[#2563eb] px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-[#1d4ed8]"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                <path d="M6 2.5v7M2.5 6h7" />
              </svg>
              <span>Add Group</span>
            </button>
          </div>
        </div>

        <div className="p-5">
          {/* Ruler */}
          <div className="relative mb-2.5 h-5 border-b border-white/[0.07]">
            {ticks.map((sec) => (
              <span
                key={sec}
                className="mono-num absolute top-0 -translate-x-1/2 text-[11.5px] text-[#6b7485]"
                style={{ left: `${(sec / timelineMax) * 100}%` }}
              >
                {sec}s
              </span>
            ))}
          </div>

          {/* Track Lanes */}
          <div ref={tracksRef} className="relative space-y-2.5">
            {ticks.map((sec) => (
              <span
                key={sec}
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/[0.05]"
                style={{ left: `${(sec / timelineMax) * 100}%` }}
              />
            ))}

            {playing && (
              <span
                className="pointer-events-none absolute top-0 bottom-0 z-20 w-[2px] rounded-full bg-[#3b82f6]"
                style={{ left: `${Math.min(100, (playheadSec / timelineMax) * 100)}%` }}
              />
            )}

            {wave.groups.map((g, gi) => {
              const span = Math.max(0.5, (g.count - 1) * g.interval);
              const leftPct = Math.min(96, (g.startDelay / timelineMax) * 100);
              const widthPct = Math.min(100 - leftPct, Math.max(5, (span / timelineMax) * 100));
              const endSec = g.startDelay + Math.max(0, g.count - 1) * g.interval;
              const selected = gi === safeGroupIdx;
              const meta = ENEMY_META[g.zombieType];
              const isSpawningNow = playing && playheadSec >= g.startDelay && playheadSec <= endSec + 0.15;
              const beatCount = Math.min(24, Math.max(1, g.count));

              return (
                <div
                  key={gi}
                  onClick={() => onSelectGroup(gi)}
                  className={`relative h-11 cursor-pointer rounded-xl border transition-colors ${
                    selected
                      ? 'border-white/15 bg-[#191e29]'
                      : 'border-white/[0.06] bg-[#0e1016] hover:border-white/10'
                  }`}
                >
                  <div
                    onMouseDown={(e) => startDragDelay(gi, g.startDelay, e)}
                    title="Drag horizontally to adjust Start Delay"
                    className="absolute top-1.5 bottom-1.5 flex cursor-grab items-center justify-between overflow-hidden rounded-lg border px-3 active:cursor-grabbing"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      backgroundColor: meta.fill,
                      borderColor: selected || isSpawningNow ? meta.dot : meta.border,
                    }}
                  >
                    <div className="pointer-events-none absolute inset-x-1.5 bottom-1 flex justify-between opacity-45">
                      {Array.from({ length: beatCount }).map((_, bi) => (
                        <span key={bi} className="h-1 w-[1.5px] rounded-full" style={{ backgroundColor: meta.dot }} />
                      ))}
                    </div>

                    <span className="relative z-10 flex min-w-0 items-center gap-2 text-[12.5px] font-medium text-white">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta.dot }} />
                      <span className="truncate">
                        {meta.short} ×{g.count}
                      </span>
                    </span>
                    <span className="mono-num relative z-10 ml-2 hidden shrink-0 text-[11.5px] font-medium sm:inline" style={{ color: meta.text }}>
                      {g.startDelay.toFixed(1)}s–{endSec.toFixed(1)}s
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Focused Group Inspector */}
      {activeGroup && activeEnemyCfg && (
        <section className="rounded-2xl border border-white/[0.08] bg-[#14171f] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[14px] font-semibold text-white">
                Group #{safeGroupIdx + 1}
              </span>
              <span className="mono-num rounded-full border border-white/[0.08] bg-[#0e1016] px-3 py-1 text-[12px] text-[#949db0]">
                HP {activeEnemyCfg.maxHp} · Armor {Math.round(activeEnemyCfg.armor * 100)}% · {activeEnemyCfg.speed} m/s
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onDuplicateGroup(safeGroupIdx)}
                className="flex h-8 cursor-pointer items-center rounded-lg border border-white/10 bg-white/[0.05] px-3 text-[12px] font-medium text-[#d1d6e0] transition-colors hover:bg-white/[0.09] hover:text-white"
              >
                Duplicate
              </button>
              <button
                type="button"
                disabled={wave.groups.length <= 1}
                onClick={() => onRemoveGroup(safeGroupIdx)}
                className="flex h-8 cursor-pointer items-center rounded-lg border border-[#3a2229] bg-[#1d1418] px-3 text-[12px] font-medium text-[#fda4af] transition-colors hover:bg-[#2b1a20] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          </div>

          {/* Friendly Enemy Type Pill Bar */}
          <div className="mt-4 flex flex-wrap gap-2">
            {ZOMBIE_TYPES.map((type: ZombieTypeId) => {
              const meta = ENEMY_META[type];
              const active = activeGroup.zombieType === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onUpdateGroup(safeGroupIdx, { zombieType: type })}
                  className={`flex h-9 cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-[13px] font-medium transition-colors ${
                    active
                      ? 'border-[#3b82f6] bg-[#1a2947] text-white'
                      : 'border-white/[0.08] bg-[#0f1219] text-[#949db0] hover:border-white/15 hover:text-white'
                  }`}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.dot }} />
                  <span>{ENEMY_CONFIGS[type].name}</span>
                </button>
              );
            })}
          </div>

          {/* Tactile Parameters */}
          <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-3">
            <div>
              <label className="block text-[12px] font-medium text-[#8b95a7]">Unit Count</label>
              <div className="mt-2 flex h-10 items-center overflow-hidden rounded-xl border border-white/10 bg-[#0f1219]">
                <button
                  type="button"
                  onClick={() => onUpdateGroup(safeGroupIdx, { count: Math.max(1, activeGroup.count - 1) })}
                  className="flex h-full w-10 cursor-pointer items-center justify-center border-r border-white/[0.08] text-base text-[#949db0] hover:bg-white/[0.06] hover:text-white"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  value={activeGroup.count}
                  onChange={(e) => onUpdateGroup(safeGroupIdx, { count: Math.max(1, Number(e.target.value) || 1) })}
                  className="mono-num h-full min-w-0 flex-1 bg-transparent text-center text-[13.5px] font-semibold text-white outline-none"
                />
                <button
                  type="button"
                  onClick={() => onUpdateGroup(safeGroupIdx, { count: activeGroup.count + 1 })}
                  className="flex h-full w-10 cursor-pointer items-center justify-center border-l border-white/[0.08] text-base text-[#949db0] hover:bg-white/[0.06] hover:text-white"
                >
                  +
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-[12px]">
                <label className="font-medium text-[#8b95a7]">Interval (s)</label>
                <input
                  type="number"
                  min={0.05}
                  step={0.05}
                  value={activeGroup.interval}
                  onChange={(e) => onUpdateGroup(safeGroupIdx, { interval: Math.max(0.05, Number(e.target.value) || 0.5) })}
                  className="mono-num h-8 w-20 rounded-lg border border-white/10 bg-[#0f1219] px-2.5 text-right text-[13px] font-medium text-white outline-none focus:border-[#3b82f6]"
                />
              </div>
              <input
                type="range"
                min={0.1}
                max={3.0}
                step={0.05}
                value={Math.min(3.0, activeGroup.interval)}
                onChange={(e) => onUpdateGroup(safeGroupIdx, { interval: Number(e.target.value) })}
                className="dcc-slider mt-3"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-[12px]">
                <label className="font-medium text-[#8b95a7]">Start Delay (s)</label>
                <input
                  type="number"
                  min={0}
                  step={0.25}
                  value={activeGroup.startDelay}
                  onChange={(e) => onUpdateGroup(safeGroupIdx, { startDelay: Math.max(0, Number(e.target.value) || 0) })}
                  className="mono-num h-8 w-20 rounded-lg border border-white/10 bg-[#0f1219] px-2.5 text-right text-[13px] font-medium text-white outline-none focus:border-[#3b82f6]"
                />
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(20, timelineMax)}
                step={0.25}
                value={Math.min(Math.max(20, timelineMax), activeGroup.startDelay)}
                onChange={(e) => onUpdateGroup(safeGroupIdx, { startDelay: Number(e.target.value) })}
                className="dcc-slider mt-3"
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
