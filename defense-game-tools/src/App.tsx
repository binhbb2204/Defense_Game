import { useCallback, useState } from 'react';
import {
  TOWER_CONFIGS,
  WAVE_DEFINITIONS,
  createEmptyMap,
  type MapDefinition,
  type TowerArchetypeConfig,
  type WaveDefinition,
} from '@tactical-td/shared';
import { BalanceSim } from './modules/balance-sim/BalanceSim';
import { MapEditor } from './modules/map-editor/MapEditor';
import { TowerLab } from './modules/tower-lab/TowerLab';
import { WaveDesigner } from './modules/wave-designer/WaveDesigner';
import { ToolShell, type ToolTabId } from './ui/ToolShell';

export function App() {
  const [activeTab, setActiveTab] = useState<ToolTabId>('map-editor');
  const [map, setMap] = useState<MapDefinition>(() => createEmptyMap());
  const [waves, setWaves] = useState<WaveDefinition[]>(() => structuredClone(WAVE_DEFINITIONS));
  const [towers, setTowers] = useState<Record<string, TowerArchetypeConfig>>(() =>
    structuredClone(TOWER_CONFIGS),
  );
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const notify = useCallback((type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    window.setTimeout(() => {
      setToast((cur) => (cur?.text === text ? null : cur));
    }, 3500);
  }, []);

  const handleChangeTower = useCallback((id: string, next: TowerArchetypeConfig) => {
    setTowers((prev) => ({ ...prev, [id]: next }));
  }, []);

  return (
    <ToolShell
      activeTab={activeTab}
      currentMapId={map.id}
      onSelectTab={setActiveTab}
      toast={toast}
    >
      {activeTab === 'map-editor' && (
        <MapEditor map={map} onChangeMap={setMap} onNotify={notify} />
      )}
      {activeTab === 'wave-designer' && (
        <WaveDesigner
          mapId={map.id || 'highway_01'}
          startingCash={map.startingCash}
          waves={waves}
          onChangeWaves={setWaves}
          onNotify={notify}
        />
      )}
      {activeTab === 'tower-lab' && (
        <TowerLab towers={towers} onChangeTower={handleChangeTower} onNotify={notify} />
      )}
      {activeTab === 'balance-sim' && (
        <BalanceSim map={map} waves={waves} towers={towers} />
      )}
    </ToolShell>
  );
}
