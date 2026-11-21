import {
  HIGHWAY_01_MAP,
  WAVE_DEFINITIONS,
  type MapDefinition,
  type ZombieTypeId,
} from '@tactical-td/shared';
import { AssetLoader } from './core/AssetLoader';
import { GameLoop, type LoopStats } from './core/GameLoop';
import { World } from './core/World';
import { ZombiePool, type ZombieRecord } from './entities/Zombie';
import { enemyRegistry } from './entities/enemies/EnemyRegistry';
import { PathSystem } from './systems/PathSystem';
import { WaveManager } from './systems/WaveManager';
import { useGameStore } from '../ui/store/useGameStore';

const INITIAL_PREP_SEC = 5;
const INTERMISSION_SEC = 5;

/**
 * Top-level pure TypeScript Engine Orchestrator.
 * Owns World, GameLoop (60Hz), PathSystem, WaveManager, and ZombiePool.
 * Includes automatic wave countdown (prep / intermission timer) with optional early skip bonus.
 */
export class GameEngine {
  public readonly world: World;
  public readonly assetLoader: AssetLoader;
  public readonly loop: GameLoop;
  public readonly pathSystem: PathSystem;
  public readonly zombiePool: ZombiePool;
  public readonly waveManager: WaveManager;

  private readonly mapData: MapDefinition;
  private baseHp: number;
  private cash: number;
  private waveInProgress = false;
  private showDebugPath = true;
  private gameOver = false;
  private victory = false;

  // Auto-wave countdown state (simulated inside 60Hz fixedUpdate)
  private nextWaveCountdownSec = INITIAL_PREP_SEC;
  private nextWaveDurationSec = INITIAL_PREP_SEC;
  private lastPushedCountdownTenth = -1;
  private waveElapsedSec = 0;
  private waveTimeLimitSec = 0;

  // Ready-up lobby (Co-op: needs 3/4 of players, solo needs 1/1)
  private matchStarted = false;
  private playerCount = 1;
  private remoteReadyCount = 0;
  private localReady = false;

  // Skip-wave vote (same threshold as ready: solo 1, co-op 3/4)
  private localSkipVote = false;
  private remoteSkipVotes = 0;
  private lastAwardedWaveNumber = 0;

  constructor(container: HTMLElement, mapData: MapDefinition = HIGHWAY_01_MAP) {
    this.mapData = mapData;
    this.baseHp = mapData.baseHp;
    this.cash = mapData.startingCash;

    this.world = new World(container);
    this.assetLoader = new AssetLoader();
    this.pathSystem = new PathSystem(mapData.waypoints, mapData.defaultRoadWidth, 512);
    this.world.buildPrototypeMap(mapData, this.pathSystem);
    this.world.setDebugVisible(this.showDebugPath);

    this.zombiePool = new ZombiePool(1024, this.assetLoader, enemyRegistry);
    this.world.entitiesGroup.add(this.zombiePool.group);

    this.waveManager = new WaveManager(WAVE_DEFINITIONS, {
      onSpawnZombie: this.handleSpawnZombie,
      onWaveStarted: (wave) => {
        this.waveInProgress = true;
        this.localSkipVote = false;
        this.remoteSkipVotes = 0;

        // Estimated wave length: last spawn + time for the slowest group to walk the path.
        const pathLen = this.pathSystem.getTotalLength();
        let est = 0;
        for (const g of wave.groups) {
          const speed = enemyRegistry.get(g.zombieType).config.speed;
          est = Math.max(est, g.startDelay + (g.count - 1) * g.interval + pathLen / speed);
        }
        this.waveTimeLimitSec = est;
        this.waveElapsedSec = 0;
        this.nextWaveDurationSec = est;
        this.nextWaveCountdownSec = est;
        this.lastPushedCountdownTenth = -1;

        useGameStore.getState().setWaveStatus({
          wave: wave.waveNumber,
          waveName: wave.name,
          waveActive: true,
          nextWaveCountdownSec: est,
          nextWaveDurationSec: est,
        });
      },
    });

    this.loop = new GameLoop(
      {
        onFixedUpdate: this.onFixedUpdate,
        onRender: this.onRender,
        onStats: this.onStats,
      },
      { fixedHz: 60 },
    );

    this.pushFullHudState();
  }

  public start(): void {
    this.loop.start();
  }

  /**
   * Skips remaining countdown and triggers the next wave immediately.
   * Awards a small early-call tactical cash bonus (+$2 per whole second skipped).
   */
  /** Toggle the local player's skip vote. The next wave only starts once enough players agree. */
  public toggleSkipVote(): void {
    if (!this.matchStarted || !this.waveInProgress || this.gameOver || this.victory) return;
    if (!this.waveManager.hasMoreWaves()) return;
    this.localSkipVote = !this.localSkipVote;
    this.checkSkipVotes();
    this.pushFullHudState();
  }

  /** Co-op hook (Phase 5): number of other players currently voting to skip. */
  public setRemoteSkipVotes(count: number): void {
    this.remoteSkipVotes = Math.max(0, count);
    if (this.waveInProgress) this.checkSkipVotes();
    this.pushFullHudState();
  }

  private checkSkipVotes(): void {
    const votes = this.remoteSkipVotes + (this.localSkipVote ? 1 : 0);
    if (votes >= this.getRequiredReady()) {
      this.skipCurrentWave();
    }
  }

  /**
   * Skips the remainder of the current wave and enters the 5s waiting time
   * before the next wave spawns (existing zombies stay active on the map).
   */
  public skipCurrentWave(): void {
    if (!this.matchStarted || !this.waveInProgress || this.gameOver || this.victory) return;
    if (!this.waveManager.hasMoreWaves()) return;
    if (this.loop.isPaused()) {
      this.loop.resume();
    }

    this.awardCurrentWaveBonusOnce();
    this.waveInProgress = false;
    this.localSkipVote = false;
    this.remoteSkipVotes = 0;
    this.nextWaveDurationSec = INTERMISSION_SEC;
    this.nextWaveCountdownSec = INTERMISSION_SEC;
    this.lastPushedCountdownTenth = -1;
    this.pushFullHudState();
  }

  private awardCurrentWaveBonusOnce(): void {
    const current = this.waveManager.getCurrentWave();
    if (current && current.waveNumber > this.lastAwardedWaveNumber) {
      this.cash += current.clearBonus;
      this.lastAwardedWaveNumber = current.waveNumber;
    }
  }

  public startNextWave(): void {
    if (!this.matchStarted || this.gameOver || this.victory) return;
    if (!this.waveManager.hasMoreWaves()) return;
    if (this.loop.isPaused()) {
      this.loop.resume();
    }
    this.waveManager.startNextWave();
    this.pushFullHudState();
  }

  /** Votes required to start: 1 for solo, otherwise 3/4 of the room (2->2, 3->3, 4->3). */
  public getRequiredReady(): number {
    return this.playerCount <= 1 ? 1 : Math.ceil(this.playerCount * 0.75);
  }

  /** Toggle the local player's ready state; starts the match once enough players agree. */
  public toggleReady(): void {
    if (this.matchStarted) return;
    this.localReady = !this.localReady;
    this.checkReadyStart();
    this.pushFullHudState();
  }

  /** Co-op hook (Phase 5): server tells us room size and how many others are ready. */
  public setRoomState(playerCount: number, remoteReadyCount: number): void {
    this.playerCount = Math.max(1, Math.min(4, playerCount));
    this.remoteReadyCount = Math.max(0, remoteReadyCount);
    if (!this.matchStarted) this.checkReadyStart();
    this.pushFullHudState();
  }

  private checkReadyStart(): void {
    const ready = this.remoteReadyCount + (this.localReady ? 1 : 0);
    if (ready >= this.getRequiredReady()) {
      this.matchStarted = true;
      this.nextWaveDurationSec = INITIAL_PREP_SEC;
      this.nextWaveCountdownSec = INITIAL_PREP_SEC;
      this.lastPushedCountdownTenth = -1;
    }
  }

  public togglePause(): void {
    this.loop.togglePause();
    useGameStore.getState().setPlayback(this.loop.isPaused(), this.loop.getTimeScale());
  }

  public setTimeScale(scale: number): void {
    this.loop.setTimeScale(scale);
    useGameStore.getState().setPlayback(this.loop.isPaused(), this.loop.getTimeScale());
  }

  public toggleDebugPath(): void {
    this.showDebugPath = !this.showDebugPath;
    this.world.setDebugVisible(this.showDebugPath);
    useGameStore.getState().setDebugPathVisible(this.showDebugPath);
  }

  public resetCamera(): void {
    this.world.resetCamera();
  }

  public resetMatch(): void {
    this.zombiePool.clearAll();
    this.waveManager.reset();
    this.loop.resetSimClock();
    this.loop.resume();

    this.baseHp = this.mapData.baseHp;
    this.cash = this.mapData.startingCash;
    this.waveInProgress = false;
    this.gameOver = false;
    this.victory = false;
    this.matchStarted = false;
    this.localReady = false;
    this.remoteReadyCount = 0;
    this.localSkipVote = false;
    this.remoteSkipVotes = 0;
    this.lastAwardedWaveNumber = 0;
    this.nextWaveDurationSec = INITIAL_PREP_SEC;
    this.nextWaveCountdownSec = INITIAL_PREP_SEC;
    this.lastPushedCountdownTenth = -1;
    this.pushFullHudState();
  }

  private readonly handleSpawnZombie = (
    zombieType: ZombieTypeId,
    laneOffset: number,
  ): void => {
    this.zombiePool.spawnByType(zombieType, laneOffset, this.pathSystem);
  };

  private readonly handleZombieReachedBase = (zombie: Readonly<ZombieRecord>): void => {
    if (this.gameOver) return;
    this.baseHp = Math.max(0, this.baseHp - zombie.baseDamage);
    if (this.baseHp === 0) {
      this.gameOver = true;
      this.waveInProgress = false;
      this.loop.pause();
    }
    useGameStore.getState().setCombatState({
      baseHp: this.baseHp,
      cash: this.cash,
      aliveZombies: Math.max(0, this.zombiePool.getActiveCount() - 1),
      gameOver: this.gameOver,
      victory: this.victory,
    });
  };

  private readonly onFixedUpdate = (fixedDt: number): void => {
    if (this.gameOver || this.victory || !this.matchStarted) return;

    // 1. Always simulate active spawners & zombies (including during post-skip 5s waiting time)
    this.waveManager.fixedUpdate(fixedDt);
    this.zombiePool.fixedUpdate(fixedDt, this.pathSystem, this.handleZombieReachedBase);

    // 2. Waiting Time (Intermission / Prep 5s countdown -> auto-start next wave)
    if (!this.waveInProgress) {
      if (this.waveManager.hasMoreWaves()) {
        this.nextWaveCountdownSec = Math.max(0, this.nextWaveCountdownSec - fixedDt);

        const tenth = Math.ceil(this.nextWaveCountdownSec * 10);
        if (tenth !== this.lastPushedCountdownTenth) {
          this.lastPushedCountdownTenth = tenth;
          useGameStore.getState().setCountdown(tenth / 10);
        }

        if (this.nextWaveCountdownSec <= 0) {
          this.waveManager.startNextWave();
          this.pushFullHudState();
        }
      }
      return;
    }

    // 3. During Wave: update Wave "Time Left" (10Hz UI throttle)
    this.waveElapsedSec += fixedDt;
    this.nextWaveCountdownSec = Math.max(0, this.waveTimeLimitSec - this.waveElapsedSec);
    const waveTenth = Math.ceil(this.nextWaveCountdownSec * 10);
    if (waveTenth !== this.lastPushedCountdownTenth) {
      this.lastPushedCountdownTenth = waveTenth;
      useGameStore.getState().setCountdown(waveTenth / 10);
    }

    // 4. Natural Wave Clear Detection -> Enter 5s waiting time for next wave
    if (!this.waveManager.isSpawning() && this.zombiePool.getActiveCount() === 0) {
      this.awardCurrentWaveBonusOnce();
      this.waveInProgress = false;

      if (!this.waveManager.hasMoreWaves()) {
        this.victory = true;
      } else {
        this.nextWaveDurationSec = INTERMISSION_SEC;
        this.nextWaveCountdownSec = INTERMISSION_SEC;
        this.lastPushedCountdownTenth = -1;
      }
      this.pushFullHudState();
    }
  };

  private readonly onRender = (alpha: number, frameDt: number): void => {
    const animDt = this.loop.isPaused() ? 0 : frameDt * this.loop.getTimeScale();
    this.zombiePool.syncRender(alpha, animDt);
    this.world.updateCamera(frameDt);
    this.world.render();
  };

  private readonly onStats = (stats: Readonly<LoopStats>): void => {
    useGameStore.getState().setTelemetry({
      fps: stats.fps,
      tps: stats.tps,
      frameTimeMs: stats.frameTimeMs,
      aliveZombies: this.zombiePool.getActiveCount(),
    });
  };

  private pushFullHudState(): void {
    const wave = this.waveManager.getCurrentWave();
    useGameStore.getState().syncSnapshot({
      matchStarted: this.matchStarted,
      playerCount: this.playerCount,
      readyCount: this.remoteReadyCount + (this.localReady ? 1 : 0),
      requiredReady: this.getRequiredReady(),
      localReady: this.localReady,
      skipVotes: this.remoteSkipVotes + (this.localSkipVote ? 1 : 0),
      localSkipVoted: this.localSkipVote,
      mapName: this.mapData.name,
      wave: this.waveManager.getCurrentWaveNumber(),
      totalWaves: this.waveManager.getTotalWaves(),
      waveName: wave?.name ?? 'Perimeter Prep',
      waveActive: this.waveInProgress,
      nextWaveCountdownSec: Number(this.nextWaveCountdownSec.toFixed(1)),
      nextWaveDurationSec: this.nextWaveDurationSec,
      aliveZombies: this.zombiePool.getActiveCount(),
      baseHp: this.baseHp,
      maxBaseHp: this.mapData.baseHp,
      cash: this.cash,
      paused: this.loop.isPaused(),
      timeScale: this.loop.getTimeScale(),
      showDebugPath: this.showDebugPath,
      gameOver: this.gameOver,
      victory: this.victory,
    });
  }

  public dispose(): void {
    this.loop.stop();
    this.zombiePool.dispose();
    this.assetLoader.dispose();
    this.world.dispose();
  }
}
