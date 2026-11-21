import { useEffect } from 'react';
import { TOWER_CONFIGS } from '@tactical-td/shared';
import { useGameStore } from '../store/useGameStore';
import { Icon, towerIconName } from './Icons';

const LOADOUT_SIZE = 5;
const BADGE_COLORS = ['#e23b3b', '#4a8fe2', '#e8b923', '#8a4fd6', '#d65fa0'];

/** Bottom loadout: 5 slots. Unfilled slots are empty. */
export function TowerBar() {
  const cash = useGameStore((s) => s.cash);
  const selected = useGameStore((s) => s.selectedTowerType);
  const setSelected = useGameStore((s) => s.setSelectedTowerType);

  // Player loadout (max 5). Currently every available tower is equipped.
  const loadout = Object.values(TOWER_CONFIGS).slice(0, LOADOUT_SIZE);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const idx = Number(e.key) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < loadout.length) {
        const id = loadout[idx].id;
        const cur = useGameStore.getState().selectedTowerType;
        setSelected(cur === id ? null : id);
      } else if (e.key === 'Escape') {
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loadout, setSelected]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-2 z-10 flex items-end justify-center gap-4">
      <div className="pointer-events-auto flex items-end gap-1.5">
        {Array.from({ length: LOADOUT_SIZE }).map((_, idx) => {
          const tower = loadout[idx];
          const badge = (
            <span
              className="txt-outline absolute -left-1 -top-1.5 flex h-5 w-5 items-center justify-center rounded-md border-2 border-black text-[11px]"
              style={{ background: BADGE_COLORS[idx] }}
            >
              {idx + 1}
            </span>
          );

          if (!tower) {
            return (
              <div
                key={`empty-${idx}`}
                className="relative h-16 w-16 rounded-[7px] border-2 border-dashed border-white/15 bg-black/30"
              >
                {badge}
              </div>
            );
          }

          const canAfford = cash >= tower.baseCost;
          const active = selected === tower.id;
          return (
            <button
              key={tower.id}
              type="button"
              onClick={() => setSelected(active ? null : tower.id)}
              title={tower.name}
              className={`slot relative flex h-16 w-16 items-center justify-center pb-3 ${active ? 'slot-active' : ''}`}
            >
              {badge}
              <Icon name={towerIconName(tower.id, tower.category)} className="h-8 w-8 text-white drop-shadow" />
              <span
                className={`txt-outline absolute inset-x-0 bottom-0.5 text-[13px] ${
                  canAfford ? 'text-[#6bff7e]' : 'text-[#ff5b5b]'
                }`}
              >
                ${tower.baseCost}
              </span>
            </button>
          );
        })}
      </div>

      <div className="pointer-events-none flex items-center gap-1.5 pb-2">
        <Icon name="coin" className="h-6 w-6" />
        <span className="txt-outline text-xl text-[#6bff7e]">${cash.toLocaleString()}</span>
      </div>
    </div>
  );
}
