import type * as THREE from 'three';

/**
 * Abstract base builder for modular Three.js road network features (SRP / OCP).
 */
export abstract class BaseRoadFeatureBuilder<TInput> {
  abstract build(input: TInput): THREE.Object3D | null;
}
