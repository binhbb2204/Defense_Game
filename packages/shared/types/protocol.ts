export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type WaypointSegmentMode = 'straight' | 'curve';
export type WaypointElevationMode = 'ground' | 'elevated' | 'bridge' | 'tunnel';
export type WaypointSlopeMode = 'straight_slope' | 'pchip_smooth';

export const MAP_SCHEMA_VERSION = 4;

export type RoadNodeRole = 'normal' | 'spawn' | 'base';

export interface RoadNode {
  id: string;
  x: number;
  y: number;
  z: number;
  role: RoadNodeRole;
  label?: string;
  /** True keeps a sharp corner even when incident segments are smoothed curves. */
  corner?: boolean;
}

export type RoadSegmentKind = 'straight' | 'curve';

export interface RoadSegment {
  id: string;
  a: string;
  b: string;
  width: number;
  kind: RoadSegmentKind;
  /** Optional explicit quadratic control handle (used by live Road tool handles / legacy curves). */
  control?: Vec3;
  /** Tension 0..1 for derived Catmull-Rom curves (0 = nearly straight, 0.5 = default, 1 = loose). */
  tension?: number;
  /** When true, routes traverse only a -> b (used by Shape Reverse / directional lanes). */
  oneWay?: boolean;
  /** Relative routing preference when multiple outgoing paths leave a junction (default = 1, equal split). */
  weight?: number;
  elevationMode?: WaypointElevationMode;
  slopeMode?: WaypointSlopeMode;
  isTunnel?: boolean;
  isOverpass?: boolean;
  roadPartAsset?: string;
}

export interface WaypointNode {
  /** Optional stable node identifier for editor tracking. */
  id?: string;
  /** Optional display label (e.g., Gate North, Overpass Entry). */
  label?: string;
  x: number;
  y: number;
  z: number;
  /** Total traversable road width at this node (meters/world units). */
  roadWidth?: number;
  /** Marks path segment starting/continuing inside a covered tunnel (blocks LoS). */
  isTunnel?: boolean;
  /** Marks elevated bridge/overpass deck section. */
  isOverpass?: boolean;
  /** Outgoing segment geometry mode from this node to the next node. */
  segmentMode?: WaypointSegmentMode;
  /** 2D horizontal Quadratic Bezier control point for outgoing curve segment (when segmentMode === 'curve'). */
  curveControl?: Vec2;
  /** Explicit Network Anarchy elevation mode for this node / outgoing span. */
  elevationMode?: WaypointElevationMode;
  /** Vertical slope interpolation profile for outgoing span: linear ramp vs monotone PCHIP. */
  slopeMode?: WaypointSlopeMode;
  /** Optional imported 3D model filename bent along outgoing segment. */
  roadPartAsset?: string;
}

export interface PathNode extends WaypointNode {
  id: string;
  label?: string;
}

export interface MapPath {
  id: string;
  name: string;
  color: string;
  width: number;
  loop: boolean;
  visible?: boolean;
  locked?: boolean;
  nodes: PathNode[];
}

export interface MapJunctionOut {
  pathId: string;
  weight: number;
}

export interface MapJunction {
  id: string;
  name?: string;
  pos: Vec3;
  inPaths: string[];
  outPaths: MapJunctionOut[];
}

export type ObstacleKind =
  | 'wall'
  | 'container'
  | 'pillar'
  | 'tunnel_shell'
  | 'hill';

export interface MapObstacle {
  id: string;
  kind: ObstacleKind;
  position: Vec3;
  size: Vec3;
  rotationY?: number;
  /** True if this mesh contributes to three-mesh-bvh True Line-of-Sight occlusion. */
  blocksLoS: boolean;
  color?: string;
  visible?: boolean;
  locked?: boolean;
  customProperties?: Record<string, string | number | boolean>;
}

export type TowerCategory = 'infantry' | 'sniper' | 'explosive' | 'support';

export interface ElevatedZone {
  id: string;
  label: string;
  kind: 'rooftop' | 'watchtower' | 'overpass_deck';
  position: Vec3;
  size: Vec3;
  rotationY?: number;
  allowedCategories?: TowerCategory[];
  visible?: boolean;
  locked?: boolean;
  customProperties?: Record<string, string | number | boolean>;
}

export type CustomModelFormat = 'glb' | 'gltf' | 'fbx' | 'obj';

export interface MapCustomModel {
  id: string;
  name: string;
  assetName: string;
  format: CustomModelFormat;
  position: Vec3;
  scale: Vec3;
  rotationY: number;
  blocksLoS: boolean;
  isHighGround?: boolean;
  color?: string;
  visible?: boolean;
  locked?: boolean;
  customProperties?: Record<string, string | number | boolean>;
}

export interface MapDefinition {
  id: string;
  name: string;
  version: number;
  bounds: {
    width: number;
    depth: number;
  };
  baseHp: number;
  startingCash: number;
  defaultRoadWidth: number;
  /** Graph v3 representation (Cities: Skylines style nodes + segments). */
  nodes?: RoadNode[];
  segments?: RoadSegment[];
  /** Legacy v1 waypoints kept synced for backward-compatible runtime pathing & sims. */
  waypoints: WaypointNode[];
  /** Legacy v2 lane array (migrated automatically to v3 graph on load). */
  paths?: MapPath[];
  junctions?: MapJunction[];
  obstacles: MapObstacle[];
  elevatedZones: ElevatedZone[];
  customModels?: MapCustomModel[];
  sceneGlbPath?: string;
}

export type ZombieTypeId = 'normal' | 'speedy' | 'armored' | 'boss';

export interface ZombieArchetypeConfig {
  id: ZombieTypeId;
  name: string;
  maxHp: number;
  /** Flat/percentage physical armor mitigation against standard bullets (0..1). */
  armor: number;
  /** Movement speed in world units per second. */
  speed: number;
  radius: number;
  height: number;
  cashReward: number;
  baseDamage: number;
  color: string;
  /** Path relative to client public/ directory (e.g. "/models/enemies/normal.glb"). */
  modelPath?: string;
  /** Optional SFX paths relative to client public/ directory (e.g. "/sounds/enemies/..."). */
  sounds?: {
    hit?: string;
    death?: string;
    ability?: string;
  };
  isBoss?: boolean;
}

export interface WaveSpawnGroup {
  zombieType: ZombieTypeId;
  count: number;
  /** Seconds between each spawn inside this group. */
  interval: number;
  /** Delay in seconds from wave start before first unit of this group spawns. */
  startDelay: number;
}

export interface WaveDefinition {
  waveNumber: number;
  name: string;
  clearBonus: number;
  groups: WaveSpawnGroup[];
}

export type TowerUpgradePathId = 'top' | 'bottom';

export interface TowerLevelConfig {
  level: number;
  pathId?: TowerUpgradePathId;
  pathName?: string;
  modelPath?: string;
  vfxPreset?: string;
  upgradeCost: number;
  damage: number;
  fireRate: number;
  range: number;
  turnSpeedRad: number;
  projectileSpeed: number;
  splashRadius?: number;
  friendlyStunDuration?: number;
  detectHidden?: boolean;
  pierceLead?: boolean;
  hitFlying?: boolean;
  armorPen?: number;
  branches?: Partial<Record<TowerUpgradePathId, TowerLevelConfig>>;
}

export interface TowerArchetypeConfig {
  id: string;
  name: string;
  category: TowerCategory;
  baseCost: number;
  footprintRadius: number;
  requiresHighGround?: boolean;
  /** Path relative to client public/ directory (e.g. "/models/towers/rifleman.glb"). */
  modelPath?: string;
  /** Optional SFX paths relative to client public/ directory. */
  sounds?: {
    fire?: string;
    impact?: string;
  };
  levels: TowerLevelConfig[];
}

/** Phase 5 Co-op WebSocket Protocol Contracts */
export type ClientMessage =
  | { type: 'JOIN_ROOM'; roomId: string; playerName: string }
  | { type: 'PLACE_TOWER'; towerType: string; position: Vec3; tick: number }
  | { type: 'UPGRADE_TOWER'; towerId: string; tick: number }
  | { type: 'SELL_TOWER'; towerId: string; tick: number }
  | { type: 'START_WAVE'; waveNumber: number };

export type ServerMessage =
  | { type: 'ROOM_STATE'; roomId: string; seed: number; mapId: string; players: string[] }
  | { type: 'COMMAND_BROADCAST'; playerId: string; payload: ClientMessage }
  | { type: 'WAVE_SYNC'; waveNumber: number; seed: number; serverTimeMs: number };
