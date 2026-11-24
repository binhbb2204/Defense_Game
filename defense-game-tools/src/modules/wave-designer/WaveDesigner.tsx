import { useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WaveDefinition, WaveSpawnGroup } from '@tactical-td/shared';
import { ShellHeaderContext } from '../../ui/ShellHeaderContext';
import { computeCampaignStats } from './waveMetrics';
import { WaveSidebar } from './WaveSidebar';
import { WaveTimelineStage } from './WaveTimelineStage';

interface WaveDesignerProps {
  mapId: string;
  startingCash: number;
  waves: WaveDefinition[];
  onChangeWaves: (next: WaveDefinition[]) => void;
  onNotify: (type: 'ok' | 'err', text: string) => void;
}

/**
 * Modern friendly Wave Designer pairing an EHP curve & wave list on the left
 * with a spacious DAW-style timeline stage and focused group inspector.
 */
export function WaveDesigner({
  mapId,
  startingCash,
  waves,
  onChangeWaves,
  onNotify,
}: WaveDesignerProps) {
  const { rightSlot } = useContext(ShellHeaderContext);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [selectedGroupIdx, setSelectedGroupIdx] = useState(0);
  const [saving, setSaving] = useState(false);

  const safeIdx = Math.min(selectedIdx, Math.max(0, waves.length - 1));
  const wave = waves[safeIdx];

  const cumulativeStats = useMemo(
    () => computeCampaignStats(waves, startingCash),
    [waves, startingCash],
  );

  const updateWave = (nextWave: WaveDefinition) => {
    const next = [...waves];
    next[safeIdx] = nextWave;
    onChangeWaves(next);
  };

  const updateGroup = (groupIdx: number, patch: Partial<WaveSpawnGroup>) => {
    if (!wave) return;
    const groups = [...wave.groups];
    groups[groupIdx] = { ...groups[groupIdx], ...patch };
    updateWave({ ...wave, groups });
  };

  const addWave = () => {
    const n = waves.length + 1;
    const next: WaveDefinition = {
      waveNumber: n,
      name: `Wave ${n}`,
      clearBonus: 120 + n * 60,
      groups: [{ zombieType: 'normal', count: 10 + n * 2, interval: 0.75, startDelay: 0.5 }],
    };
    onChangeWaves([...waves, next]);
    setSelectedIdx(waves.length);
    setSelectedGroupIdx(0);
  };

  const duplicateWave = (idx: number) => {
    const src = waves[idx];
    if (!src) return;
    const copy: WaveDefinition = {
      ...structuredClone(src),
      name: `${src.name} Copy`,
      waveNumber: waves.length + 1,
    };
    const next = [...waves.slice(0, idx + 1), copy, ...waves.slice(idx + 1)].map((w, i) => ({
      ...w,
      waveNumber: i + 1,
    }));
    onChangeWaves(next);
    setSelectedIdx(idx + 1);
    setSelectedGroupIdx(0);
  };

  const deleteWave = (idx: number) => {
    if (waves.length <= 1) {
      onNotify('err', 'Must keep at least 1 wave.');
      return;
    }
    const filtered = waves
      .filter((_, i) => i !== idx)
      .map((w, i) => ({ ...w, waveNumber: i + 1 }));
    onChangeWaves(filtered);
    setSelectedIdx(Math.max(0, idx - 1));
    setSelectedGroupIdx(0);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/shared/waves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapId, waves }),
      });
      const json = (await res.json()) as { ok: boolean; filePath?: string; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || 'Save failed');
      onNotify('ok', `Saved waves/${mapId}.json`);
    } catch (err) {
      onNotify('err', err instanceof Error ? err.message : 'Failed to save waves');
    } finally {
      setSaving(false);
    }
  };

  if (!wave) return null;
  const stats = cumulativeStats[safeIdx];
  const timelineMax = Math.max(12, stats.durationSec + 2);
  const density = stats.durationSec > 0 ? (stats.totalCount / stats.durationSec).toFixed(1) : `${stats.totalCount}`;

  const headerControls = (
    <div className="flex items-center gap-2">
      <span className="hidden rounded-lg border border-white/[0.08] bg-[#0e1016] px-2.5 py-1 text-[12px] text-[#8b95a7] sm:inline">
        waves/{mapId}.json
      </span>
      <button
        type="button"
        disabled={saving}
        onClick={handleSave}
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-[#2563eb] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#1d4ed8] disabled:opacity-50"
      >
        <span>{saving ? 'Saving...' : 'Save'}</span>
      </button>
    </div>
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#0e1015]">
      {rightSlot && createPortal(headerControls, rightSlot)}

      <WaveSidebar
        waves={waves}
        statsList={cumulativeStats}
        selectedIdx={safeIdx}
        onSelectWave={(idx) => {
          setSelectedIdx(idx);
          setSelectedGroupIdx(0);
        }}
        onAddWave={addWave}
        onDuplicateWave={duplicateWave}
      />

      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-[1160px] space-y-6">
          {/* Clean Editable Title Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="mono-num shrink-0 rounded-full border border-white/[0.09] bg-[#14171f] px-3 py-1 text-[12px] font-medium text-[#93c5fd]">
                Wave {wave.waveNumber} of {waves.length}
              </span>
              <input
                type="text"
                value={wave.name}
                onChange={(e) => updateWave({ ...wave, name: e.target.value })}
                aria-label="Wave name"
                className="min-w-[200px] flex-1 rounded-xl border border-transparent bg-transparent px-2.5 py-1 text-[22px] font-semibold tracking-[-0.02em] text-white outline-none hover:border-white/10 focus:border-[#3b82f6] focus:bg-[#14171f]"
              />
            </div>

            <div className="flex items-center gap-2.5">
              <label className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-[#14171f] px-3 text-[12.5px] text-[#8b95a7]">
                <span>Clear bonus $</span>
                <input
                  type="number"
                  value={wave.clearBonus}
                  onChange={(e) => updateWave({ ...wave, clearBonus: Number(e.target.value) || 0 })}
                  className="mono-num w-16 bg-transparent text-right font-semibold text-white outline-none"
                />
              </label>

              <button
                type="button"
                disabled={waves.length <= 1}
                onClick={() => deleteWave(safeIdx)}
                title="Delete Wave"
                className="flex h-9 cursor-pointer items-center rounded-lg border border-[#3a2229] bg-[#1d1418] px-3.5 text-[12.5px] font-medium text-[#fda4af] transition-colors hover:bg-[#2b1a20] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete
              </button>
            </div>
          </div>

          {/* Unified Soft Rounded 4-Metric Strip */}
          <div className="grid grid-cols-2 divide-y divide-white/[0.07] rounded-2xl border border-white/[0.08] bg-[#14171f] md:grid-cols-4 md:divide-x md:divide-y-0">
            <div className="px-5 py-4">
              <div className="text-[12px] font-medium text-[#8b95a7]">Hostiles</div>
              <div className="mono-num mt-1 text-[24px] font-semibold tracking-[-0.02em] text-white">
                {stats.totalCount}
              </div>
              <div className="mono-num mt-1 text-[12px] text-[#6b7485]">
                {wave.groups.length} spawn {wave.groups.length === 1 ? 'group' : 'groups'}
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="text-[12px] font-medium text-[#8b95a7]">Effective HP</div>
              <div className="mono-num mt-1 text-[24px] font-semibold tracking-[-0.02em] text-white">
                {stats.effectiveHp.toLocaleString()}
              </div>
              <div className="mono-num mt-1 text-[12px] text-[#6b7485]">
                Raw {stats.rawHp.toLocaleString()} HP
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="text-[12px] font-medium text-[#8b95a7]">Duration</div>
              <div className="mono-num mt-1 text-[24px] font-semibold tracking-[-0.02em] text-white">
                {stats.durationSec}s
              </div>
              <div className="mono-num mt-1 text-[12px] text-[#6b7485]">
                ~{density} units/sec
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="text-[12px] font-medium text-[#8b95a7]">Wave Income</div>
              <div className="mono-num mt-1 text-[24px] font-semibold tracking-[-0.02em] text-[#86efac]">
                +${stats.totalReward.toLocaleString()}
              </div>
              <div className="mono-num mt-1 text-[12px] text-[#6b7485]">
                Budget ${stats.cashAfterWave.toLocaleString()}
              </div>
            </div>
          </div>

          <WaveTimelineStage
            wave={wave}
            timelineMax={timelineMax}
            selectedGroupIdx={selectedGroupIdx}
            onSelectGroup={setSelectedGroupIdx}
            onUpdateGroup={updateGroup}
            onAddGroup={() => {
              const nextGroups = [
                ...wave.groups,
                { zombieType: 'normal' as const, count: 8, interval: 0.8, startDelay: 2.0 },
              ];
              updateWave({ ...wave, groups: nextGroups });
              setSelectedGroupIdx(nextGroups.length - 1);
            }}
            onDuplicateGroup={(idx) => {
              const src = wave.groups[idx];
              if (!src) return;
              const nextGroups = [
                ...wave.groups.slice(0, idx + 1),
                { ...src, startDelay: Number((src.startDelay + 1).toFixed(2)) },
                ...wave.groups.slice(idx + 1),
              ];
              updateWave({ ...wave, groups: nextGroups });
              setSelectedGroupIdx(idx + 1);
            }}
            onRemoveGroup={(idx) => {
              const nextGroups = wave.groups.filter((_, i) => i !== idx);
              updateWave({ ...wave, groups: nextGroups });
              setSelectedGroupIdx(Math.max(0, idx - 1));
            }}
          />
        </div>
      </main>
    </div>
  );
}
