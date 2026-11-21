import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { Icon } from './Icons';

export interface WaveHUDProps {
  onStartWave: () => void;
  onToggleReady: () => void;
  onTogglePause: () => void;
  onSetTimeScale: (scale: number) => void;
  onToggleDebugPath: () => void;
  onResetCamera: () => void;
  onResetMatch: () => void;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Keeps an element mounted for `ms` after `visible` turns false so exit animations can play. */
function usePresence(visible: boolean, ms: number): boolean {
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [visible, ms]);
  return mounted || visible;
}

export function WaveHUD({
  onStartWave,
  onToggleReady,
  onTogglePause,
  onSetTimeScale,
  onToggleDebugPath,
  onResetCamera,
  onResetMatch,
}: WaveHUDProps) {
  const matchStarted = useGameStore((s) => s.matchStarted);
  const readyCount = useGameStore((s) => s.readyCount);
  const requiredReady = useGameStore((s) => s.requiredReady);
  const localReady = useGameStore((s) => s.localReady);
  const skipVotes = useGameStore((s) => s.skipVotes);
  const localSkipVoted = useGameStore((s) => s.localSkipVoted);
  const playerCount = useGameStore((s) => s.playerCount);
  const wave = useGameStore((s) => s.wave);
  const totalWaves = useGameStore((s) => s.totalWaves);
  const waveActive = useGameStore((s) => s.waveActive);
  const timeLeft = useGameStore((s) => s.nextWaveCountdownSec);
  const duration = useGameStore((s) => s.nextWaveDurationSec);
  const aliveZombies = useGameStore((s) => s.aliveZombies);
  const baseHp = useGameStore((s) => s.baseHp);
  const maxBaseHp = useGameStore((s) => s.maxBaseHp);
  const cash = useGameStore((s) => s.cash);
  const paused = useGameStore((s) => s.paused);
  const timeScale = useGameStore((s) => s.timeScale);
  const showDebugPath = useGameStore((s) => s.showDebugPath);
  const fps = useGameStore((s) => s.fps);
  const gameOver = useGameStore((s) => s.gameOver);
  const victory = useGameStore((s) => s.victory);

  const hpRatio = maxBaseHp > 0 ? Math.max(0, Math.min(1, baseHp / maxBaseHp)) : 0;
  const hpClass = hpRatio > 0.5 ? 'bar-green' : hpRatio > 0.25 ? 'bar-yellow' : 'bar-red';
  const shownWave = waveActive ? wave : Math.min(totalWaves, wave + 1);

  // Skip = call the next wave early. Only during a wave, after 1/4 of its time has passed.
  const elapsedRatio = duration > 0 ? 1 - timeLeft / duration : 0;
  const skipVisible =
    matchStarted && waveActive && !gameOver && !victory && wave < totalWaves && elapsedRatio >= 0.25;
  const skipMounted = usePresence(skipVisible, 300);

  // Ready card: stays a moment after the match starts to show the "all ready" celebration.
  const [celebrate, setCelebrate] = useState(false);
  const prevStarted = useRef(matchStarted);
  useEffect(() => {
    if (matchStarted && !prevStarted.current) {
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 1100);
      prevStarted.current = matchStarted;
      return () => clearTimeout(t);
    }
    prevStarted.current = matchStarted;
  }, [matchStarted]);
  const readyVisible = (!matchStarted || celebrate) && !gameOver && !victory;
  const readyMounted = usePresence(readyVisible, 340);
  const allReady = matchStarted;

  const pipCount = Math.max(1, requiredReady);

  return (
    <>
      {/* TOP CENTER: Wave | Base Health | Time Left */}
      <div className="pointer-events-none fixed inset-x-0 top-2 z-10 flex flex-col items-center gap-1.5">
        <div className="flex items-start gap-5">
          <div className="w-14 text-center">
            <div className="txt-outline text-[13px]">Wave</div>
            <div className="txt-outline text-lg leading-tight">
              {matchStarted ? `${shownWave}/${totalWaves}` : '--'}
            </div>
          </div>

          <div className="w-[300px] text-center">
            <div className="txt-outline text-[13px]">Base Health</div>
            <div className="relative">
              <div className="bar-track h-6">
                <div
                  className={`${hpClass} h-full transition-[width] duration-200`}
                  style={{ width: `${hpRatio * 100}%` }}
                />
              </div>
              <span className="absolute -left-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border-2 border-black bg-[#2fb24a] text-white">
                <Icon name="plus" className="h-4 w-4" />
              </span>
              <div className="txt-outline absolute inset-0 flex items-center justify-center text-sm">
                {baseHp} / {maxBaseHp}
              </div>
            </div>
          </div>

          <div className="w-24 text-center">
            <div className="txt-outline flex items-center justify-center gap-1 text-[13px]">
              <Icon name="hourglass" className="h-3.5 w-3.5" />
              Time Left
            </div>
            <div className="txt-outline text-xl leading-tight">
              {matchStarted ? formatTime(timeLeft) : '00:00'}
            </div>
          </div>
        </div>

        {/* Ready card */}
        {readyMounted && (
          <div
            className={`ready-card pointer-events-auto mt-2 flex items-stretch gap-3.5 p-2 pl-3.5 ${
              allReady ? 'ready-card-ok' : ''
            } ${readyVisible ? 'anim-pop-in' : 'anim-pop-out'}`}
          >
            <div className="flex min-w-[116px] flex-col justify-between py-0.5 text-left">
              <div className="txt-outline text-[19px] leading-none">
                {allReady ? 'All Ready!' : 'Ready?'}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <div className="flex items-center gap-1">
                  {Array.from({ length: pipCount }).map((_, i) => {
                    const on = allReady || i < readyCount;
                    return (
                      <span key={i} className={`pip ${on ? 'pip-on' : ''}`}>
                        {on && <Icon name="check" className="anim-check h-2.5 w-2.5" />}
                      </span>
                    );
                  })}
                </div>
                <span className="txt-outline text-[12px] leading-none opacity-85">
                  <span key={readyCount} className="anim-bump">
                    {allReady ? requiredReady : readyCount}
                  </span>
                  /{requiredReady} Required
                  {playerCount > 1 ? ` · ${playerCount}P` : ''}
                </span>
              </div>
            </div>

            {allReady ? (
              <div className="txt-outline flex min-w-[112px] items-center justify-center gap-1.5 rounded-[8px] border-2 border-black/40 bg-black/25 px-4 text-sm text-[#b9ffc6]">
                <Icon name="check" className="anim-check h-4 w-4 text-[#6bff7e]" />
                Starting...
              </div>
            ) : (
              <button
                type="button"
                onClick={onToggleReady}
                className={`btn btn-shine txt-outline flex min-w-[112px] items-center justify-center gap-1.5 rounded-[8px] px-4 text-[15px] leading-none tracking-wide ${
                  localReady ? 'btn-gray' : 'btn-green anim-glow'
                }`}
              >
                <Icon name={localReady ? 'close' : 'play'} className="h-3.5 w-3.5" />
                {localReady ? 'CANCEL' : 'READY'}
              </button>
            )}
          </div>
        )}

        {/* Skip vote card (during wave, after 1/4 wave time) */}
        {skipMounted && (
          <div
            className={`ready-card pointer-events-auto mt-1.5 flex items-stretch gap-3 p-1.5 pl-3 ${
              skipVisible ? 'anim-pop-in' : 'anim-pop-out'
            }`}
          >
            <div className="flex flex-col justify-between py-0.5 text-left">
              <div className="txt-outline text-[16px] leading-none">Skip Wave?</div>
              <div className="mt-1 flex items-center gap-1.5">
                <div className="flex items-center gap-1">
                  {Array.from({ length: pipCount }).map((_, i) => {
                    const on = i < skipVotes;
                    return (
                      <span key={i} className={`pip ${on ? 'pip-on' : ''}`}>
                        {on && <Icon name="check" className="anim-check h-2.5 w-2.5" />}
                      </span>
                    );
                  })}
                </div>
                <span className="txt-outline text-[11px] leading-none opacity-85">
                  <span key={skipVotes} className="anim-bump">
                    {skipVotes}
                  </span>
                  /{requiredReady} Votes
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onStartWave}
              className={`btn btn-shine txt-outline flex min-w-[96px] items-center justify-center gap-1.5 rounded-[8px] px-3.5 text-sm leading-none ${
                localSkipVoted ? 'btn-gray' : 'btn-green anim-glow'
              }`}
            >
              {localSkipVoted ? 'VOTED' : 'SKIP'}
              <Icon name={localSkipVoted ? 'check' : 'forward'} className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* TOP RIGHT: quick tools + leaderboard */}
      <div className="fixed right-2 top-2 z-10 flex w-56 flex-col gap-2">
        <div className="flex justify-end gap-1.5">
          <button type="button" onClick={onTogglePause} title="Pause" className="slot pointer-events-auto flex h-9 w-9 items-center justify-center">
            <Icon name={paused ? 'play' : 'pause'} className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onSetTimeScale(timeScale === 1 ? 2 : 1)}
            title="Game speed"
            className={`slot txt-outline pointer-events-auto flex h-9 w-9 items-center justify-center text-xs ${timeScale > 1 ? 'slot-active' : ''}`}
          >
            {timeScale}x
          </button>
          <button
            type="button"
            onClick={onToggleDebugPath}
            title="Show path"
            className={`slot pointer-events-auto flex h-9 w-9 items-center justify-center ${showDebugPath ? 'slot-active' : ''}`}
          >
            <Icon name="route" className="h-4 w-4" />
          </button>
          <button type="button" onClick={onResetCamera} title="Reset camera (R)" className="slot pointer-events-auto flex h-9 w-9 items-center justify-center">
            <Icon name="camera" className="h-4 w-4" />
          </button>
        </div>

        {/* Leaderboard card */}
        <div className="pointer-events-none overflow-hidden rounded-xl border-2 border-black bg-[#1d2227]/90 shadow-lg">
          <div className="flex items-center gap-2 bg-gradient-to-r from-[#2d5f9a] to-[#244a78] px-3 py-1.5">
            <Icon name="trophy" className="h-4 w-4 text-[#ffd23f]" />
            <span className="txt-outline text-xs tracking-wide">Leaderboard</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ffd23f] text-black">
              <Icon name="crown" className="h-3.5 w-3.5" />
            </span>
            <span className="txt-outline flex-1 truncate text-sm">You</span>
            <span className="flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-xs">
              <Icon name="coin" className="h-3.5 w-3.5" />
              {cash.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-white/10 px-3 py-1 text-[11px] text-white/70">
            <span className="flex items-center gap-1">
              <Icon name="skull" className="h-3 w-3" />
              {aliveZombies}
            </span>
            <span>{fps} FPS</span>
          </div>
        </div>
      </div>

      <div className="txt-outline pointer-events-none fixed bottom-2 left-2 z-10 text-[11px] opacity-75">
        WASD move · Right-drag / Q E rotate · Scroll zoom
      </div>

      {(gameOver || victory) && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60">
          <div className="panel anim-pop-in w-80 p-5 text-center">
            <h2 className={`txt-outline text-3xl ${victory ? 'text-[#6bff7e]' : 'text-[#ff6b6b]'}`}>
              {victory ? 'Victory!' : 'Game Over'}
            </h2>
            <p className="mt-2 text-sm opacity-80">
              {victory ? 'You cleared every wave!' : 'The zombies broke through.'}
            </p>
            <button type="button" onClick={onResetMatch} className="btn btn-red txt-outline mt-4 px-6 py-2 text-base">
              Restart Match
            </button>
          </div>
        </div>
      )}
    </>
  );
}
