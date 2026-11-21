export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface WaypointNode {
  x: number;
  y: number;
  z: number;
  /** Total traversable road width at this node (meters/world units). */
  roadWidth?: number;
  /** Marks path segment starting/continuing inside a covered tunnel (blocks LoS). */
  isTunnel?: boolean;
  /** Marks elevated bridge/overpass deck section. */
  isOverpass?: boolean;
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
  waypoints: WaypointNode[];
  obstacles: MapObstacle[];
  elevatedZones: ElevatedZone[];
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

export interface TowerLevelConfig {
  level: number;
  upgradeCost: number;
  damage: number;
  fireRate: number;
  range: number;
  turnSpeedRad: number;
  projectileSpeed: number;
  splashRadius?: number;
  friendlyStunDuration?: number;
}

export interface TowerArchetypeConfig {
  id: string;
  name: string;
  category: TowerCategory;
  baseCost: number;
  footprintRadius: number;
  requiresHighGround?: boolean;
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
