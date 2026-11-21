export interface LoopStats {
  fps: number;
  tps: number;
  frameTimeMs: number;
  simTimeSec: number;
  paused: boolean;
  timeScale: number;
}

export interface GameLoopCallbacks {
  /** Deterministic simulation tick executed strictly at fixedHz (default 60Hz). */
  onFixedUpdate: (fixedDt: number, elapsedSimTime: number) => void;
  /**
   * Variable-rate render hook executed once per animation frame.
   * `alpha` in [0, 1) represents interpolation factor between previous and current sim tick.
   */
  onRender: (alpha: number, frameDt: number) => void;
  /** Low-frequency (~4Hz) telemetry callback for UI HUD. */
  onStats?: (stats: Readonly<LoopStats>) => void;
}

export interface GameLoopOptions {
  /** Simulation frequency in Hz (default: 60). */
  fixedHz?: number;
  /** Maximum accepted frame delta in seconds before clamping (prevents spiral of death). */
  maxFrameDeltaSec?: number;
  /** Hard cap on fixed substeps executed within a single animation frame. */
  maxSubstepsPerFrame?: number;
  /** Interval in ms between stats telemetry updates. */
  statsIntervalMs?: number;
}

/**
 * Fixed-timestep (60Hz) simulation + variable-framerate interpolated render loop.
 * Strictly zero heap allocations inside the hot RAF tick path.
 */
export class GameLoop {
  public readonly fixedDt: number;
  private readonly maxFrameDeltaSec: number;
  private readonly maxSubstepsPerFrame: number;
  private readonly statsIntervalMs: number;
  private readonly callbacks: GameLoopCallbacks;

  private rafId: number | null = null;
  private running = false;
  private paused = false;
  private timeScale = 1.0;

  private lastTimestampMs = 0;
  private accumulatorSec = 0;
  private elapsedSimTimeSec = 0;

  // Telemetry accumulators (reused primitive fields to avoid GC churn)
  private statsLastFlushMs = 0;
  private statsFrameCount = 0;
  private statsTickCount = 0;
  private statsFrameTimeSumMs = 0;
  private readonly statsSnapshot: LoopStats = {
    fps: 0,
    tps: 0,
    frameTimeMs: 0,
    simTimeSec: 0,
    paused: false,
    timeScale: 1,
  };

  constructor(callbacks: GameLoopCallbacks, options: GameLoopOptions = {}) {
    const fixedHz = options.fixedHz ?? 60;
    this.fixedDt = 1 / fixedHz;
    this.maxFrameDeltaSec = options.maxFrameDeltaSec ?? 0.1;
    this.maxSubstepsPerFrame = options.maxSubstepsPerFrame ?? 5;
    this.statsIntervalMs = options.statsIntervalMs ?? 250;
    this.callbacks = callbacks;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    const now = performance.now();
    this.lastTimestampMs = now;
    this.statsLastFlushMs = now;
    this.accumulatorSec = 0;

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.rafId = requestAnimationFrame(this.tick);
  }

  public stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastTimestampMs = performance.now();
  }

  public togglePause(): boolean {
    if (this.paused) {
      this.resume();
    } else {
      this.pause();
    }
    return this.paused;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public setTimeScale(scale: number): void {
    // Clamp tactical playback speed safely between 0.5x and 3.0x
    this.timeScale = Math.max(0.5, Math.min(3.0, scale));
  }

  public getTimeScale(): number {
    return this.timeScale;
  }

  public getElapsedSimTime(): number {
    return this.elapsedSimTimeSec;
  }

  public resetSimClock(): void {
    this.accumulatorSec = 0;
    this.elapsedSimTimeSec = 0;
  }

  private readonly handleVisibilityChange = (): void => {
    if (!document.hidden) {
      // Discard time elapsed while tab/window was suspended to avoid simulation spikes.
      this.lastTimestampMs = performance.now();
      this.accumulatorSec = 0;
    }
  };

  private readonly tick = (nowMs: number): void => {
    if (!this.running) return;

    const rawDeltaMs = nowMs - this.lastTimestampMs;
    this.lastTimestampMs = nowMs;

    const clampedFrameDt = Math.min(
      Math.max(rawDeltaMs * 0.001, 0),
      this.maxFrameDeltaSec,
    );

    if (!this.paused) {
      this.accumulatorSec += clampedFrameDt * this.timeScale;

      let substeps = 0;
      while (
        this.accumulatorSec >= this.fixedDt &&
        substeps < this.maxSubstepsPerFrame
      ) {
        this.elapsedSimTimeSec += this.fixedDt;
        this.callbacks.onFixedUpdate(this.fixedDt, this.elapsedSimTimeSec);
        this.accumulatorSec -= this.fixedDt;
        this.statsTickCount++;
        substeps++;
      }

      // Drop excess backlog if CPU cannot sustain real-time simulation
      if (substeps === this.maxSubstepsPerFrame && this.accumulatorSec > this.fixedDt) {
        this.accumulatorSec = 0;
      }
    }

    const alpha = this.paused ? 1 : this.accumulatorSec / this.fixedDt;
    this.callbacks.onRender(alpha, clampedFrameDt);

    // Telemetry tracking
    this.statsFrameCount++;
    this.statsFrameTimeSumMs += rawDeltaMs;

    const statsElapsedMs = nowMs - this.statsLastFlushMs;
    if (statsElapsedMs >= this.statsIntervalMs) {
      const invSec = 1000 / statsElapsedMs;
      this.statsSnapshot.fps = Math.round(this.statsFrameCount * invSec);
      this.statsSnapshot.tps = Math.round(this.statsTickCount * invSec);
      this.statsSnapshot.frameTimeMs =
        this.statsFrameCount > 0
          ? Number((this.statsFrameTimeSumMs / this.statsFrameCount).toFixed(1))
          : 0;
      this.statsSnapshot.simTimeSec = this.elapsedSimTimeSec;
      this.statsSnapshot.paused = this.paused;
      this.statsSnapshot.timeScale = this.timeScale;

      this.callbacks.onStats?.(this.statsSnapshot);

      this.statsLastFlushMs = nowMs;
      this.statsFrameCount = 0;
      this.statsTickCount = 0;
      this.statsFrameTimeSumMs = 0;
    }

    this.rafId = requestAnimationFrame(this.tick);
  };
}
