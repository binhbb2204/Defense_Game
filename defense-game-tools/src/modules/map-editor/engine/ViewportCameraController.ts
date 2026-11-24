import * as THREE from 'three';
import type { Vec3 } from '@tactical-td/shared';
import { isTypingTarget, type DragMode, type ViewportCameraCallbacks } from './ViewportTypes';

const UP = new THREE.Vector3(0, 1, 0);
const GROUND_PLANE = new THREE.Plane(UP, 0);
const MIN_PITCH = THREE.MathUtils.degToRad(14);
const MAX_PITCH = THREE.MathUtils.degToRad(86);
const MIN_DISTANCE = 6;
const MAX_DISTANCE = 220;
const CLICK_THRESHOLD_PX = 4;

/**
 * Custom Three.js DCC Viewport Controller:
 * - Left-drag (>4px): Pan across XZ plane
 * - Middle-drag (>4px): Pan fallback
 * - Right-drag (>4px): Orbit / Rotate camera around target
 * - Wheel: Smooth zoom toward target
 * - Pointer capture + stopPropagation prevents camera & tool double-handling
 * - Left/Right click (<=4px total movement) dispatches cleanly to active tool
 * - Mathematical invisible XZ ground plane intersection for jitter-free placement
 */
export class ViewportCameraController {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly domElement: HTMLElement;
  public readonly target = new THREE.Vector3(0, 0, 0);

  private yaw = Math.PI * 0.25;
  private pitch = THREE.MathUtils.degToRad(52);
  private distance = 62;

  private dragMode: DragMode = 'none';
  private activePointerId: number | null = null;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private maxMoveDist = 0;
  private suppressedByGizmo = false;
  private lastHoverClientX = 0;
  private lastHoverClientY = 0;
  private lastAltHeld = false;
  private lastShiftHeld = false;
  private pointerInside = false;

  private readonly pressedKeys = new Set<string>();
  private readonly callbacks: ViewportCameraCallbacks;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly _fwd = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _move = new THREE.Vector3();
  private readonly _hitPrev = new THREE.Vector3();
  private readonly _hitCurr = new THREE.Vector3();

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    callbacks: ViewportCameraCallbacks,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.callbacks = callbacks;

    this.applySpherical();
    this.attach();
  }

  private attach(): void {
    this.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.domElement.addEventListener('pointermove', this.onPointerMove);
    this.domElement.addEventListener('pointerup', this.onPointerUp);
    this.domElement.addEventListener('pointercancel', this.onPointerCancel);
    this.domElement.addEventListener('pointerleave', this.onPointerLeave);
    this.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    this.domElement.addEventListener('dblclick', this.onDoubleClick);
    this.domElement.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
  }

  public dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.domElement.removeEventListener('pointercancel', this.onPointerCancel);
    this.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.domElement.removeEventListener('wheel', this.onWheel);
    this.domElement.removeEventListener('dblclick', this.onDoubleClick);
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
  }

  public resetTransient(): void {
    this.pressedKeys.clear();
    if (
      this.activePointerId !== null &&
      this.domElement.hasPointerCapture(this.activePointerId)
    ) {
      this.domElement.releasePointerCapture(this.activePointerId);
    }
    this.activePointerId = null;
    this.dragMode = 'none';
    this.maxMoveDist = 0;
    this.suppressedByGizmo = false;
  }

  public focusOn(pos: Vec3, distance = 22): void {
    this.target.set(pos.x, pos.y, pos.z);
    this.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, distance));
    this.applySpherical();
  }

  public snapView(mode: 'top' | 'iso'): void {
    if (mode === 'top') {
      this.pitch = THREE.MathUtils.degToRad(87);
      this.yaw = 0;
      this.distance = 72;
    } else {
      this.pitch = THREE.MathUtils.degToRad(48);
      this.yaw = Math.PI * 0.25;
      this.distance = 60;
    }
    this.applySpherical();
  }

  /** Intersects mathematical horizontal plane `y = planeY` (never raycasts meshes). */
  public raycastGroundPlane(clientX: number, clientY: number, planeY = 0): Vec3 | null {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const plane =
      planeY === 0 ? GROUND_PLANE : new THREE.Plane(UP, -planeY);
    const hit = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(plane, hit);
    if (!ok) return null;
    return { x: hit.x, y: planeY, z: hit.z };
  }

  public update(dt: number): void {
    if (this.pressedKeys.size === 0 || isTypingTarget()) {
      return;
    }
    this.camera.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    if (this._fwd.lengthSq() > 1e-4) this._fwd.normalize();
    else this._fwd.set(0, 0, -1);

    this._right.crossVectors(this._fwd, UP).normalize();
    this._move.set(0, 0, 0);

    if (this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp')) this._move.add(this._fwd);
    if (this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown')) this._move.sub(this._fwd);
    if (this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight')) this._move.add(this._right);
    if (this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft')) this._move.sub(this._right);
    if (this.pressedKeys.has('KeyE')) this._move.y += 1;
    if (this.pressedKeys.has('KeyQ')) this._move.y -= 1;

    if (this._move.lengthSq() > 0) {
      const boost =
        this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight') ? 2.4 : 1.0;
      this._move.normalize().multiplyScalar(36 * boost * dt);
      this.target.add(this._move);
      if (this.target.y < 0) this.target.y = 0;
      this.applySpherical();
    }
  }

  private applySpherical(): void {
    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);

    this.camera.position.set(
      this.target.x + this.distance * cosP * sinY,
      Math.max(1.2, this.target.y + this.distance * sinP),
      this.target.z + this.distance * cosP * cosY,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  private panByScreenDelta(prevX: number, prevY: number, curX: number, curY: number): void {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const plane = new THREE.Plane(UP, -this.target.y);
    this.ndc.set(((prevX - rect.left) / rect.width) * 2 - 1, -((prevY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hitA = this.raycaster.ray.intersectPlane(plane, this._hitPrev);

    this.ndc.set(((curX - rect.left) / rect.width) * 2 - 1, -((curY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hitB = this.raycaster.ray.intersectPlane(plane, this._hitCurr);

    if (hitA && hitB) {
      const dx = this._hitPrev.x - this._hitCurr.x;
      const dz = this._hitPrev.z - this._hitCurr.z;
      const clampStep = 14;
      this.target.x += Math.max(-clampStep, Math.min(clampStep, dx));
      this.target.z += Math.max(-clampStep, Math.min(clampStep, dz));
      this.applySpherical();
      return;
    }

    // Fallback when looking nearly parallel to ground
    const speed = this.distance * 0.0018;
    const dx = curX - prevX;
    const dy = curY - prevY;
    this.camera.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    this._fwd.normalize();
    this._right.crossVectors(this._fwd, UP).normalize();
    this.target.addScaledVector(this._right, -dx * speed);
    this.target.addScaledVector(this._fwd, dy * speed);
    this.applySpherical();
  }

  private readonly onPointerDown = (ev: PointerEvent): void => {
    this.lastHoverClientX = ev.clientX;
    this.lastHoverClientY = ev.clientY;
    this.lastAltHeld = ev.altKey;
    this.lastShiftHeld = ev.shiftKey;
    this.pointerInside = true;

    if (this.callbacks.shouldYieldToGizmo()) {
      this.suppressedByGizmo = true;
      return;
    }
    this.suppressedByGizmo = false;
    this.activePointerId = ev.pointerId;
    this.downX = ev.clientX;
    this.downY = ev.clientY;
    this.lastX = ev.clientX;
    this.lastY = ev.clientY;
    this.maxMoveDist = 0;

    if (ev.button === 0 || ev.button === 1) {
      this.dragMode = 'pan';
    } else if (ev.button === 2) {
      this.dragMode = 'rotate';
    } else {
      this.dragMode = 'none';
    }

    try {
      this.domElement.setPointerCapture(ev.pointerId);
    } catch {
      // Ignore if pointer cannot be captured
    }
    ev.stopPropagation();
  };

  private readonly onPointerMove = (ev: PointerEvent): void => {
    if (this.suppressedByGizmo || this.callbacks.shouldYieldToGizmo()) {
      return;
    }

    if (this.activePointerId === ev.pointerId && this.dragMode !== 'none') {
      const totalDist = Math.hypot(ev.clientX - this.downX, ev.clientY - this.downY);
      if (totalDist > this.maxMoveDist) this.maxMoveDist = totalDist;

      if (this.maxMoveDist > CLICK_THRESHOLD_PX) {
        if (this.dragMode === 'pan') {
          this.panByScreenDelta(this.lastX, this.lastY, ev.clientX, ev.clientY);
        } else if (this.dragMode === 'rotate') {
          const dx = ev.clientX - this.lastX;
          const dy = ev.clientY - this.lastY;
          this.yaw -= dx * 0.0065;
          this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch + dy * 0.0065));
          this.applySpherical();
        }
      }

      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
      ev.stopPropagation();
      return;
    }

    this.lastHoverClientX = ev.clientX;
    this.lastHoverClientY = ev.clientY;
    this.lastAltHeld = ev.altKey;
    this.lastShiftHeld = ev.shiftKey;
    this.pointerInside = true;
    this.callbacks.onPointerMoveHover?.(ev.clientX, ev.clientY, ev.altKey, ev.shiftKey);
  };

  private readonly onPointerUp = (ev: PointerEvent): void => {
    if (this.suppressedByGizmo) {
      this.suppressedByGizmo = false;
      this.activePointerId = null;
      this.dragMode = 'none';
      return;
    }

    if (this.activePointerId === ev.pointerId) {
      try {
        if (this.domElement.hasPointerCapture(ev.pointerId)) {
          this.domElement.releasePointerCapture(ev.pointerId);
        }
      } catch {
        // Ignore release race
      }
      ev.stopPropagation();

      const wasClick = this.maxMoveDist <= CLICK_THRESHOLD_PX;
      this.activePointerId = null;
      this.dragMode = 'none';

      if (wasClick) {
        if (ev.button === 0) this.callbacks.onLeftClick(ev);
        else if (ev.button === 2) this.callbacks.onRightClick(ev);
      }
    }
  };

  private readonly onPointerCancel = (ev: PointerEvent): void => {
    if (this.activePointerId === ev.pointerId) {
      this.resetTransient();
    }
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
  };

  private readonly onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    ev.stopPropagation();
    const factor = 1 + Math.sign(ev.deltaY) * Math.min(0.25, Math.abs(ev.deltaY) * 0.0012);
    this.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, this.distance * factor));
    this.applySpherical();
  };

  private readonly onDoubleClick = (ev: MouseEvent): void => {
    if (this.maxMoveDist > CLICK_THRESHOLD_PX) return;
    ev.stopPropagation();
    this.callbacks.onDoubleClick(ev);
  };

  private readonly onContextMenu = (ev: MouseEvent): void => {
    ev.preventDefault();
    ev.stopPropagation();
  };

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (isTypingTarget()) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) {
      this.emitHoverFromModifiers(ev);
      return;
    }
    this.pressedKeys.add(ev.code);
    this.emitHoverFromModifiers(ev);
  };

  private readonly onKeyUp = (ev: KeyboardEvent): void => {
    this.pressedKeys.delete(ev.code);
    this.emitHoverFromModifiers(ev);
  };

  private emitHoverFromModifiers(ev: KeyboardEvent): void {
    this.lastAltHeld = ev.altKey;
    this.lastShiftHeld = ev.shiftKey;
    if (this.pointerInside && this.dragMode === 'none' && (ev.key === 'Shift' || ev.key === 'Alt')) {
      this.callbacks.onPointerMoveHover?.(this.lastHoverClientX, this.lastHoverClientY, ev.altKey, ev.shiftKey);
    }
  }

  public refreshHover(): void {
    if (this.pointerInside && this.dragMode === 'none') {
      this.callbacks.onPointerMoveHover?.(
        this.lastHoverClientX,
        this.lastHoverClientY,
        this.lastAltHeld,
        this.lastShiftHeld,
      );
    }
  }

  private readonly onWindowBlur = (): void => {
    this.resetTransient();
  };
}
