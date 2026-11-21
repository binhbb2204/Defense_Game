import { useEffect, useRef } from 'react';
import { GameEngine } from './engine/GameEngine';
import { TowerBar } from './ui/components/TowerBar';
import { UpgradePanel } from './ui/components/UpgradePanel';
import { WaveHUD } from './ui/components/WaveHUD';

export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const engine = new GameEngine(container);
    engineRef.current = engine;
    engine.start();

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-slate-950">
      {/* Pure Three.js Canvas Mount (Zero React re-renders during gameplay) */}
      <div ref={mountRef} className="h-full w-full" />

      {/* Lightweight Zustand-driven HUD Overlay */}
      <WaveHUD
        onStartWave={() => engineRef.current?.toggleSkipVote()}
        onToggleReady={() => engineRef.current?.toggleReady()}
        onTogglePause={() => engineRef.current?.togglePause()}
        onSetTimeScale={(scale) => engineRef.current?.setTimeScale(scale)}
        onToggleDebugPath={() => engineRef.current?.toggleDebugPath()}
        onResetCamera={() => engineRef.current?.resetCamera()}
        onResetMatch={() => engineRef.current?.resetMatch()}
      />
      <TowerBar />
      <UpgradePanel />
    </main>
  );
}
