import { TOWER_CONFIGS } from '@tactical-td/shared';
import { useGameStore } from '../store/useGameStore';
import { Icon, towerIconName } from './Icons';

/**
 * Tower info panel (TDS style): portrait + stats on the left, next upgrade on the right.
 * Phase 1: previews the tower picked in the hotbar. Phase 3 binds it to placed towers.
 */
export function UpgradePanel() {
  const selectedType = useGameStore((s) => s.selectedTowerType);
  const cash = useGameStore((s) => s.cash);
  const setSelected = useGameStore((s) => s.setSelectedTowerType);

  const tower = selectedType ? TOWER_CONFIGS[selectedType] : null;
  if (!tower) return null;

  const lv = tower.levels[0];
  const next = tower.levels[1];
  const dps = (lv.damage * lv.fireRate).toFixed(1);
  const canUpgrade = next ? cash >= next.upgradeCost : false;
  const icon = towerIconName(tower.id, tower.category);

  return (
    <div className="fixed bottom-24 left-1/2 z-10 flex -translate-x-1/2 items-stretch gap-2">
      {/* Stats side tab */}
      <div className="flex flex-col gap-1.5 self-end">
        <div className="panel w-24 p-1.5 text-xs">
          <div className="txt-outline mb-1 text-center text-[11px] opacity-80">STATS</div>
          <div className="txt-outline flex items-center justify-between"><Icon name="bolt" className="h-3.5 w-3.5 text-[#ffd23f]" /><span>{lv.damage}</span></div>
          <div className="txt-outline flex items-center justify-between"><Icon name="clock" className="h-3.5 w-3.5 text-[#7fc8ff]" /><span>{(1 / lv.fireRate).toFixed(2)}</span></div>
          <div className="txt-outline flex items-center justify-between"><Icon name="crosshair" className="h-3.5 w-3.5 text-[#ff8a8a]" /><span>{lv.range}</span></div>
        </div>
        <div className="panel w-24 p-1.5 text-center">
          <div className="txt-outline text-[11px] opacity-80">DPS</div>
          <div className="txt-outline text-sm">{dps}</div>
        </div>
      </div>

      {/* Main panel */}
      <div className="panel relative flex gap-2 p-2">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="btn btn-gray absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center"
          title="Close (Esc)"
        >
          <Icon name="close" className="h-3 w-3" />
        </button>

        <div className="panel-inner flex w-40 flex-col items-center p-2">
          <div className="txt-outline text-base">{tower.name}</div>
          <div className="my-1 flex h-16 w-full items-center justify-center rounded-md bg-gradient-to-b from-[#4a4d52] to-[#2a2c30]">
            <Icon name={icon} className="h-10 w-10" />
          </div>
          <div className="txt-outline text-[11px] opacity-80">Targets: First Enemy</div>
          <div className="panel-inner mt-1 w-full px-2 py-1 text-[11px]">
            <div className="flex justify-between"><span>Level:</span><span>0</span></div>
            <div className="flex justify-between"><span>Cost:</span><span>${tower.baseCost}</span></div>
          </div>
          <button type="button" disabled className="btn btn-red txt-outline mt-1.5 w-full py-1 text-xs">
            Sell: ${Math.floor(tower.baseCost * 0.6)}
          </button>
        </div>

        <div className="flex w-56 flex-col gap-1.5">
          {next ? (
            <>
              <button
                type="button"
                disabled={!canUpgrade}
                className="btn btn-green flex items-center gap-2 px-2 py-2 text-left"
                title="Upgrade arrives with the Phase 3 economy"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded bg-black/30">
                  <Icon name="arrowUp" className="h-6 w-6" />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="txt-outline text-sm">Level 1 Upgrade</span>
                  <span className="txt-outline text-xs">${next.upgradeCost}</span>
                </span>
              </button>
              <div className="panel-inner flex-1 p-2 text-xs">
                <div className="flex justify-between"><span>Damage</span><span>{lv.damage} → {next.damage}</span></div>
                <div className="flex justify-between"><span>Fire rate</span><span>{lv.fireRate} → {next.fireRate}</span></div>
                <div className="flex justify-between"><span>Range</span><span>{lv.range} → {next.range}</span></div>
              </div>
            </>
          ) : (
            <div className="panel-inner p-2 text-sm">Max level</div>
          )}
        </div>
      </div>
    </div>
  );
}
