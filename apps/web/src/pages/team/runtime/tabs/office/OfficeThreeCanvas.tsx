import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import type {
  AgentTeamsOfficeAgent,
  AgentTeamsSidebarTeam,
} from '../../data/team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { useOfficeLayerBinding } from '../../hooks/use-office-layer-binding.js';
import type { OfficeSceneState } from './OfficeScene.js';
import { buildOffice } from './office-scene-builder.js';
import {
  createLabelTexture,
  createMonitorTexture,
  createProjectionScreenTexture,
  formatOfficeRuntimeStatus,
  makeCanvasTexture,
  OFFICE_PROJECTION_PAGE_COUNT,
  resolveOfficeAgentStatusLabel,
  resolveOfficeAgentStatusTone,
  resolveOfficeRuntimeStatus,
  type OfficeCanvasDisplayData,
  type OfficeStatusTone,
} from './office-canvas-textures.js';

// ── World units (meters) ─────────────────────────────────────────────
const ROOM_W = 16;
const ROOM_D = 9;
const ROOM_H = 3.2;

function ignoreNumericStateUpdate(): void {
  return undefined;
}

function ignorePanStateUpdate(): void {
  return undefined;
}

function resolveOfficeToneColor(tone: OfficeStatusTone): string {
  if (tone === 'warning') {
    return 'var(--warning)';
  }
  if (tone === 'danger') {
    return 'var(--danger)';
  }
  if (tone === 'accent') {
    return 'var(--accent)';
  }
  if (tone === 'muted') {
    return 'var(--fg-muted)';
  }
  return 'var(--success)';
}

// ── Seat Registry: shared positions for all zones ─────────────────────
// Used by both createBuddy (initial placement) and movement system (transitions)
const REST_D = (ROOM_D / 2) * 0.7;
const SOFA_X = -ROOM_W / 2 + 0.5;
const SOFA_Z = ROOM_D / 2 - REST_D / 2;
const SOFA_LEN = REST_D * 0.7;
const REST_RIGHT = -ROOM_W / 2 + (ROOM_W / 2) * 0.7;
const REST_FRONT = ROOM_D / 2 - REST_D;
const DOOR_CENTER = { x: REST_RIGHT - 0.5, z: REST_FRONT };

const TABLE_X = 2.0,
  TABLE_Z = 2.5,
  TABLE_W = 4.0;
const AISLE_Z = -2.2,
  ROW_OFFSET = 1.8;
const WS_XS = [-6.5, -3.9, -1.3, 1.3, 3.9, 6.5];

interface SeatDef {
  x: number;
  z: number;
  faceAngle: number;
}
const SEAT_REGISTRY = {
  rest: [
    { x: SOFA_X, z: SOFA_Z - SOFA_LEN / 2 + 0.5, faceAngle: -Math.PI / 2 },
    { x: SOFA_X, z: SOFA_Z, faceAngle: -Math.PI / 2 },
    { x: SOFA_X, z: SOFA_Z + SOFA_LEN / 2 - 0.5, faceAngle: -Math.PI / 2 },
  ] as SeatDef[],
  discuss: [
    { x: TABLE_X - TABLE_W / 2 - 0.6, z: TABLE_Z, faceAngle: -Math.PI / 2 },
    { x: TABLE_X - 1.5, z: TABLE_Z - 1.2, faceAngle: Math.PI },
    { x: TABLE_X - 0.5, z: TABLE_Z - 1.2, faceAngle: Math.PI },
    { x: TABLE_X + 0.5, z: TABLE_Z - 1.2, faceAngle: Math.PI },
    { x: TABLE_X + 1.5, z: TABLE_Z - 1.2, faceAngle: Math.PI },
    { x: TABLE_X - 1.5, z: TABLE_Z + 1.2, faceAngle: 0 },
    { x: TABLE_X - 0.5, z: TABLE_Z + 1.2, faceAngle: 0 },
    { x: TABLE_X + 0.5, z: TABLE_Z + 1.2, faceAngle: 0 },
    { x: TABLE_X + 1.5, z: TABLE_Z + 1.2, faceAngle: 0 },
  ] as SeatDef[],
  work: [
    ...WS_XS.map((dx) => ({ x: dx, z: AISLE_Z - ROW_OFFSET + 0.55, faceAngle: 0 })),
    ...WS_XS.map((dx) => ({ x: dx, z: AISLE_Z + ROW_OFFSET + 0.55, faceAngle: 0 })),
  ] as SeatDef[],
} as const;

// Zone transition waypoints: paths between zones for agent movement
function getTransitionWaypoints(
  fromZone: 'rest' | 'discuss' | 'work',
  toZone: 'rest' | 'discuss' | 'work',
  fromSeat: SeatDef,
  toSeat: SeatDef,
): { x: number; z: number }[] {
  const waypoints: { x: number; z: number }[] = [];
  // Step away from current seat
  if (fromZone === 'rest') {
    waypoints.push({ x: fromSeat.x + 0.8, z: fromSeat.z });
    waypoints.push({ ...DOOR_CENTER });
    waypoints.push({ x: DOOR_CENTER.x + 1.0, z: DOOR_CENTER.z });
  } else if (fromZone === 'discuss') {
    waypoints.push({
      x: fromSeat.x,
      z: fromSeat.z > TABLE_Z ? fromSeat.z + 0.8 : fromSeat.z - 0.8,
    });
  } else {
    waypoints.push({ x: fromSeat.x, z: AISLE_Z });
  }
  // Intermediate path
  if (fromZone === 'rest' && toZone === 'work') {
    waypoints.push({ x: 0, z: 0 });
    waypoints.push({ x: 0, z: AISLE_Z });
    waypoints.push({ x: toSeat.x, z: AISLE_Z });
  } else if (fromZone === 'rest' && toZone === 'discuss') {
    waypoints.push({ x: toSeat.x, z: DOOR_CENTER.z });
  } else if (fromZone === 'discuss' && toZone === 'rest') {
    waypoints.push({ x: DOOR_CENTER.x + 1.0, z: DOOR_CENTER.z });
    waypoints.push({ ...DOOR_CENTER });
    waypoints.push({ x: toSeat.x + 0.8, z: toSeat.z });
  } else if (fromZone === 'discuss' && toZone === 'work') {
    waypoints.push({ x: 0, z: 0 });
    waypoints.push({ x: 0, z: AISLE_Z });
    waypoints.push({ x: toSeat.x, z: AISLE_Z });
  } else if (fromZone === 'work' && toZone === 'rest') {
    waypoints.push({ x: 0, z: AISLE_Z });
    waypoints.push({ x: 0, z: 0 });
    waypoints.push({ x: DOOR_CENTER.x + 1.0, z: DOOR_CENTER.z });
    waypoints.push({ ...DOOR_CENTER });
    waypoints.push({ x: toSeat.x + 0.8, z: toSeat.z });
  } else if (fromZone === 'work' && toZone === 'discuss') {
    waypoints.push({ x: 0, z: AISLE_Z });
    waypoints.push({ x: 0, z: 0 });
  }
  // Step to target seat
  if (toZone === 'rest') {
    // already added door approach above
  } else if (toZone === 'discuss') {
    waypoints.push({ x: toSeat.x, z: toSeat.z > TABLE_Z ? toSeat.z + 0.8 : toSeat.z - 0.8 });
  } else {
    // work: already at aisle, just go to seat
  }
  // Final: the seat itself
  waypoints.push({ x: toSeat.x, z: toSeat.z });
  return waypoints;
}

// ── Palette ──────────────────────────────────────────────────────────
const COL = {
  wall: 0x5d3a1a,
  wallDark: 0x3e2510,
  ceiling: 0x2a2a3a,
  floor: 0xc2a06e,
  floorLine: 0xa88850,
  desk: 0x8b6234,
  deskTop: 0xa07844,
  chair: 0x6e7a8a,
  chairSeat: 0x4a5a6a,
  plant: 0x3fad4f,
  plantPot: 0x6e4a2e,
  shelf: 0x6e7a8a,
  shelfBook: 0xa4c4d8,
  monitor: 0x0b1323,
  monitorFrame: 0x1e2d40,
  monitorGlow: 0x5b8cff,
  window: 0x7ec8e3,
  windowFrame: 0x3e5464,
  sign: 0xf0d878,
  signBorder: 0x8d4c17,
  whiteboard: 0xe8e8e8,
  whiteboardFrame: 0x4a4a5a,
  carpet: 0x8b4562,
  carpetDark: 0x6b3050,
  coffee: 0xf5e6d0,
  coffeeHandle: 0xd4c4b0,
  lamp: 0xffeecc,
  lampShade: 0xf0d878,
  accent: 0x5b8cff,
  accentDim: 0x3a5cbf,
  textMain: 0xe8eaed,
  textDim: 0x8b949e,
  warning: 0xf0883e,
  danger: 0xf85149,
  crown: 0xffd700,
  bg: 0x1a1c2c,
};

interface BuddyState {
  tick: number;
  bodyGroup: THREE.Group;
  headMesh: THREE.Mesh;
  torsoMesh: THREE.Mesh;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  labelMesh: THREE.Mesh;
  crownMesh: THREE.Mesh | null;
  glowRing: THREE.Mesh | null;
  glowPillar: THREE.Mesh | null;
  isSelected: boolean;
  isHovered: boolean;
  baseY: number;
  bobPhase: number;
  shadowDisc: THREE.Mesh;
  bodyColor: number;
  skinColor: number;
  hairColor: number;
  status: 'working' | 'resting' | 'discussing';
  // Movement state: when status changes, agent walks to new seat
  isWalking: boolean;
  walkWaypoints: { x: number; z: number; isSeat: boolean; faceAngle?: number }[];
  walkIdx: number;
  walkSpeed: number;
}

// ── Human figure colors (seeded from agent id) ────────────────────────
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const BODY_COLORS = [
  0x3b5998, 0x2d6a4f, 0x7b2d8b, 0xc44536, 0x1b4965, 0x6b4226, 0x2c3e50, 0x8b4513,
];
const SKIN_COLORS = [0xf5d0a9, 0xe8b88a, 0xd4956b, 0xc68642, 0x8d5524, 0xf1c27d];
const HAIR_COLORS = [0x1a1a1a, 0x4a3728, 0x8b4513, 0xd4a76a, 0xc0392b, 0x2c3e50, 0xf5deb3];

function pickAgentColor(agentId: string, palette: number[]): number {
  const h = hashStr(agentId);
  return palette[h % palette.length]!;
}

// ── Build a box mesh with color ──────────────────────────────────────
function makeBox(
  w: number,
  h: number,
  d: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
  opts?: { roughness?: number; metalness?: number; castShadow?: boolean },
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: opts?.roughness ?? 0.8,
    metalness: opts?.metalness ?? 0.1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = opts?.castShadow ?? true;
  mesh.receiveShadow = true;
  return mesh;
}

// ── Create buddy (3D human figure) ─────────────────────────────────────
function createBuddy(
  agent: AgentTeamsOfficeAgent,
  isSelected: boolean,
): { group: THREE.Group; state: BuddyState } {
  const group = new THREE.Group();
  const bodyColor = pickAgentColor(agent.id, BODY_COLORS);
  const skinColor = pickAgentColor(agent.id, SKIN_COLORS);
  const hairColor = pickAgentColor(agent.id, HAIR_COLORS);

  // Body group (for bobbing animation)
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.7,
    metalness: 0.1,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: skinColor,
    roughness: 0.8,
    metalness: 0.05,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: hairColor,
    roughness: 0.9,
    metalness: 0,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: 0x2c3e50,
    roughness: 0.8,
    metalness: 0.05,
  });
  const shoeMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    roughness: 0.6,
    metalness: 0.2,
  });

  // Head (sphere)
  const headGeo = new THREE.SphereGeometry(0.14, 12, 10);
  const headMesh = new THREE.Mesh(headGeo, skinMat);
  headMesh.position.y = 1.55;
  headMesh.castShadow = true;
  bodyGroup.add(headMesh);

  // Hair (half sphere on top of head)
  const hairGeo = new THREE.SphereGeometry(0.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const hairMesh = new THREE.Mesh(hairGeo, hairMat);
  hairMesh.position.y = 1.58;
  bodyGroup.add(hairMesh);

  // Neck
  const neckGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.08, 8);
  const neckMesh = new THREE.Mesh(neckGeo, skinMat);
  neckMesh.position.y = 1.4;
  bodyGroup.add(neckMesh);

  // Torso (box)
  const torsoGeo = new THREE.BoxGeometry(0.36, 0.45, 0.2);
  const torsoMesh = new THREE.Mesh(torsoGeo, bodyMat);
  torsoMesh.position.y = 1.13;
  torsoMesh.castShadow = true;
  bodyGroup.add(torsoMesh);

  // Left arm (pivot at shoulder)
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.23, 1.3, 0);
  leftArmPivot.rotation.z = Math.PI / 4;
  const armGeo = new THREE.BoxGeometry(0.1, 0.4, 0.1);
  const leftArm = new THREE.Mesh(armGeo, bodyMat);
  leftArm.position.y = -0.2;
  leftArm.castShadow = true;
  leftArmPivot.add(leftArm);
  // Left hand
  const handGeo = new THREE.SphereGeometry(0.05, 8, 6);
  const leftHand = new THREE.Mesh(handGeo, skinMat);
  leftHand.position.y = -0.42;
  leftArmPivot.add(leftHand);
  bodyGroup.add(leftArmPivot);

  // Right arm (pivot at shoulder)
  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.23, 1.3, 0);
  rightArmPivot.rotation.z = -Math.PI / 4;
  const rightArm = new THREE.Mesh(armGeo, bodyMat);
  rightArm.position.y = -0.2;
  rightArm.castShadow = true;
  rightArmPivot.add(rightArm);
  // Right hand
  const rightHand = new THREE.Mesh(handGeo, skinMat);
  rightHand.position.y = -0.42;
  rightArmPivot.add(rightHand);
  bodyGroup.add(rightArmPivot);

  // Left leg (pivot at hip for walking animation)
  const legGeo = new THREE.BoxGeometry(0.14, 0.42, 0.14);
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.09, 0.9, 0);
  const leftLegMesh = new THREE.Mesh(legGeo, pantsMat);
  leftLegMesh.position.y = -0.21;
  leftLegMesh.castShadow = true;
  leftLegPivot.add(leftLegMesh);
  // Left shoe
  const shoeGeo = new THREE.BoxGeometry(0.14, 0.06, 0.2);
  const leftShoe = new THREE.Mesh(shoeGeo, shoeMat);
  leftShoe.position.set(0, -0.45, 0.03);
  leftLegPivot.add(leftShoe);
  bodyGroup.add(leftLegPivot);

  // Right leg
  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.09, 0.9, 0);
  const rightLegMesh = new THREE.Mesh(legGeo, pantsMat);
  rightLegMesh.position.y = -0.21;
  rightLegMesh.castShadow = true;
  rightLegPivot.add(rightLegMesh);
  // Right shoe
  const rightShoe = new THREE.Mesh(shoeGeo, shoeMat);
  rightShoe.position.set(0, -0.45, 0.03);
  rightLegPivot.add(rightShoe);
  bodyGroup.add(rightLegPivot);

  // Label (billboard above head)
  const labelTex = createLabelTexture(agent.label, isSelected, false);
  const labelW = 1.0;
  const labelH = labelW * (labelTex.image.height / labelTex.image.width);
  const labelGeo = new THREE.PlaneGeometry(labelW, labelH);
  const labelMat = new THREE.MeshBasicMaterial({
    map: labelTex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const labelMesh = new THREE.Mesh(labelGeo, labelMat);
  labelMesh.position.y = 1.85;
  bodyGroup.add(labelMesh);

  // Crown (billboard above label)
  let crownMesh: THREE.Mesh | null = null;
  if (agent.crown) {
    const crownTex = makeCanvasTexture(20, 20, (ctx) => {
      ctx.font = '16px sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffd700';
      ctx.fillText('♛', 2, 1);
    });
    const crownGeo = new THREE.PlaneGeometry(0.3, 0.3);
    const crownMat = new THREE.MeshBasicMaterial({
      map: crownTex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    crownMesh = new THREE.Mesh(crownGeo, crownMat);
    crownMesh.position.y = 2.05;
    bodyGroup.add(crownMesh);
  }

  // Selection glow ring
  let glowRing: THREE.Mesh | null = null;
  if (isSelected) {
    const ringGeo = new THREE.RingGeometry(0.5, 0.62, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: COL.accent,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    glowRing = new THREE.Mesh(ringGeo, ringMat);
    glowRing.rotation.x = -Math.PI / 2;
    glowRing.position.y = 0.01;
    group.add(glowRing);
  }

  // Selection glow pillar
  let glowPillar: THREE.Mesh | null = null;
  if (isSelected) {
    const pillarGeo = new THREE.CylinderGeometry(0.02, 0.02, ROOM_H, 8);
    const pillarMat = new THREE.MeshBasicMaterial({
      color: COL.accent,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    });
    glowPillar = new THREE.Mesh(pillarGeo, pillarMat);
    glowPillar.position.y = ROOM_H / 2;
    group.add(glowPillar);
  }

  // Shadow disc
  const shadowGeo = new THREE.CircleGeometry(0.35, 16);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.003;
  group.add(shadowDisc);

  // Position based on agent status & set initial pose
  const status = agent.status ?? 'working';
  const zoneKey = status === 'resting' ? 'rest' : status === 'discussing' ? 'discuss' : 'work';
  const seats = SEAT_REGISTRY[zoneKey];
  const agentIndex = hashStr(agent.id) % seats.length;
  const seat = seats[agentIndex]!;
  const px = seat.x;
  const pz = seat.z;
  const facingAngle = seat.faceAngle;

  // Apply sitting pose based on zone
  leftLegPivot.rotation.x = -Math.PI / 2;
  rightLegPivot.rotation.x = -Math.PI / 2;
  if (status === 'resting') {
    leftArmPivot.rotation.x = -Math.PI / 3;
    leftArmPivot.rotation.z = Math.PI / 8;
    rightArmPivot.rotation.x = -Math.PI / 3;
    rightArmPivot.rotation.z = -Math.PI / 8;
  } else if (status === 'discussing') {
    leftArmPivot.rotation.x = -Math.PI / 4;
    leftArmPivot.rotation.z = Math.PI / 10;
    rightArmPivot.rotation.x = -Math.PI / 2.5;
    rightArmPivot.rotation.z = -Math.PI / 6;
  } else {
    leftArmPivot.rotation.x = -Math.PI / 2.2;
    leftArmPivot.rotation.z = Math.PI / 6;
    rightArmPivot.rotation.x = -Math.PI / 2.2;
    rightArmPivot.rotation.z = -Math.PI / 6;
  }
  bodyGroup.position.y = -0.45;
  group.position.set(px, 0, pz);
  // Agent model faces +z by default; faceAngle convention assumes facing -z, so offset by π
  group.rotation.y = facingAngle + Math.PI;

  // Click target
  group.userData.agentId = agent.id;

  const buddyState: BuddyState = {
    tick: 0,
    bodyGroup,
    headMesh,
    torsoMesh,
    leftArm: leftArmPivot,
    rightArm: rightArmPivot,
    leftLegPivot,
    rightLegPivot,
    labelMesh,
    crownMesh,
    glowRing,
    glowPillar,
    isSelected,
    isHovered: false,
    baseY: bodyGroup.position.y,
    bobPhase: Math.random() * Math.PI * 2,
    shadowDisc,
    bodyColor,
    skinColor,
    hairColor,
    status,
    isWalking: false,
    walkWaypoints: [],
    walkIdx: 0,
    walkSpeed: 0.05,
  };

  return { group, state: buddyState };
}

// ── Main component ────────────────────────────────────────────────────
export function OfficeThreeCanvas({
  selectedAgentId,
  runtimeStatus,
  selectedSessionTitle,
  onSelectAgent,
  state,
}: {
  selectedAgentId: string;
  runtimeStatus?: AgentTeamsSidebarTeam['status'] | null;
  selectedSessionTitle?: string | null;
  onSelectAgent: (id: string) => void;
  state: OfficeSceneState;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const buddyGroupRef = useRef<THREE.Group | null>(null);
  const buddyStatesRef = useRef<BuddyState[]>([]);
  const raycasterRef = useRef(new THREE.Raycaster());
  raycasterRef.current.params.Mesh = { threshold: 0.15 };
  const mouseRef = useRef(new THREE.Vector2());
  const tickRef = useRef(0);
  const animIdRef = useRef(0);
  const monitorMeshRef = useRef<THREE.Mesh | null>(null);
  const projScreenRef = useRef<THREE.Mesh | null>(null);
  const slideIdxRef = useRef(0);
  const slideTimerRef = useRef(0);
  const hoveredIdRef = useRef<string | null>(null);
  const {
    officeAgents: rawOfficeAgents,
    metricCards,
    topSummary,
    footerStats,
    activityStats,
  } = useTeamRuntimeReferenceViewData();
  // Wave 5：叠加真实 layer/handoff 状态，让 3D agent 的工作/讨论/休息跟随实际运行态。
  const officeAgents = useOfficeLayerBinding(rawOfficeAgents);
  const officeAgentsRef = useRef<AgentTeamsOfficeAgent[]>([]);
  const metricCardsRef = useRef(metricCards);
  const topSummaryRef = useRef(topSummary);
  const footerStatsRef = useRef(footerStats);
  const activityStatsRef = useRef(activityStats);
  const runtimeStatusRef = useRef<AgentTeamsSidebarTeam['status'] | null>(runtimeStatus ?? null);
  const selectedSessionTitleRef = useRef<string | null>(selectedSessionTitle ?? null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const setZoomRef = useRef<React.Dispatch<React.SetStateAction<number>>>(ignoreNumericStateUpdate);
  const setPanRef =
    useRef<React.Dispatch<React.SetStateAction<{ x: number; y: number }>>>(ignorePanStateUpdate);
  const { zoom, setZoom, pan, setPan, dragRef } = state;

  // Keep refs in sync for animation loop / event handler access
  officeAgentsRef.current = officeAgents;
  metricCardsRef.current = metricCards;
  topSummaryRef.current = topSummary;
  footerStatsRef.current = footerStats;
  activityStatsRef.current = activityStats;
  runtimeStatusRef.current = runtimeStatus ?? null;
  selectedSessionTitleRef.current = selectedSessionTitle ?? null;
  zoomRef.current = zoom;
  panRef.current = pan;
  setZoomRef.current = setZoom;
  setPanRef.current = setPan;

  const buildDisplayData = useCallback((elapsed: number): OfficeCanvasDisplayData => {
    const effectiveRuntimeStatus = resolveOfficeRuntimeStatus({
      runtimeStatus: runtimeStatusRef.current,
      statusLabel: topSummaryRef.current.status,
    });
    const sessionTitle = selectedSessionTitleRef.current?.trim();
    return {
      topSummary: {
        ...topSummaryRef.current,
        title: sessionTitle && sessionTitle.length > 0 ? sessionTitle : topSummaryRef.current.title,
        status: formatOfficeRuntimeStatus(effectiveRuntimeStatus),
        runtimeStatus: effectiveRuntimeStatus,
      },
      metricCards: metricCardsRef.current,
      footerStats: footerStatsRef.current,
      officeAgents: officeAgentsRef.current,
      activityStats: activityStatsRef.current,
      elapsed,
    };
  }, []);

  // ── Initialize Three.js scene ──────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setClearColor(COL.bg, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(COL.bg, 20, 40);
    sceneRef.current = scene;

    const aspect = el.clientWidth / el.clientHeight;
    const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
    camera.position.set(0, 14, 12);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // ── Lights ──────────────────────────────────────────────────────
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 8, 6);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.left = -10;
    dirLight.shadow.camera.right = 10;
    dirLight.shadow.camera.top = 10;
    dirLight.shadow.camera.bottom = -10;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 30;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);

    // Monitor glow
    const monitorLight = new THREE.PointLight(0x5b8cff, 0.8, 4);
    monitorLight.position.set(0, 1.8, -3.5);
    scene.add(monitorLight);

    // Window lights
    const winLight1 = new THREE.PointLight(0x7ec8e3, 0.4, 5);
    winLight1.position.set(-5.5, 2, -3);
    scene.add(winLight1);
    const winLight2 = new THREE.PointLight(0x7ec8e3, 0.4, 5);
    winLight2.position.set(5.5, 2, -3);
    scene.add(winLight2);

    // Ceiling point lights
    const ceilLight1 = new THREE.PointLight(0xffeecc, 0.6, 6);
    ceilLight1.position.set(-3, ROOM_H - 0.5, -2);
    scene.add(ceilLight1);
    const ceilLight2 = new THREE.PointLight(0xffeecc, 0.6, 6);
    ceilLight2.position.set(3, ROOM_H - 0.5, -2);
    scene.add(ceilLight2);
    const ceilLight3 = new THREE.PointLight(0xffeecc, 0.6, 6);
    ceilLight3.position.set(0, ROOM_H - 0.5, 2);
    scene.add(ceilLight3);

    // ── Build office ────────────────────────────────────────────────
    const { monitorMesh, projScreen } = buildOffice(scene, buildDisplayData(0));
    monitorMeshRef.current = monitorMesh;
    projScreenRef.current = projScreen;

    // ── Buddy group ──────────────────────────────────────────────────
    const buddyGroup = new THREE.Group();
    scene.add(buddyGroup);
    buddyGroupRef.current = buddyGroup;

    // ── Dust particles ──────────────────────────────────────────────
    const dustCount = 40;
    const dustGeo = new THREE.BufferGeometry();
    const dustPositions = new Float32Array(dustCount * 3);
    const dustVelocities: { vx: number; vy: number; vz: number; phase: number }[] = [];
    for (let i = 0; i < dustCount; i++) {
      dustPositions[i * 3] = (Math.random() - 0.5) * ROOM_W;
      dustPositions[i * 3 + 1] = Math.random() * ROOM_H;
      dustPositions[i * 3 + 2] = (Math.random() - 0.5) * ROOM_D;
      dustVelocities.push({
        vx: (Math.random() - 0.5) * 0.002,
        vy: 0.001 + Math.random() * 0.003,
        vz: (Math.random() - 0.5) * 0.002,
        phase: Math.random() * Math.PI * 2,
      });
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.03,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const dustPoints = new THREE.Points(dustGeo, dustMat);
    scene.add(dustPoints);

    // ── Resize handler ──────────────────────────────────────────────
    const onResize = () => {
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);

    // ── Camera zoom/pan ─────────────────────────────────────────────
    const baseCamPos = new THREE.Vector3(0, 14, 12);
    const baseCamTarget = new THREE.Vector3(0, 0, 0);

    const updateCamera = () => {
      const z = Math.max(0.3, zoomRef.current);
      const dist = 18 / z;
      const dir = baseCamPos.clone().sub(baseCamTarget).normalize();
      camera.position.copy(baseCamTarget).add(dir.multiplyScalar(dist));
      camera.position.x += panRef.current.x * 0.03;
      camera.position.z += panRef.current.y * 0.03;
      const lookTarget = new THREE.Vector3(
        baseCamTarget.x + panRef.current.x * 0.03,
        baseCamTarget.y,
        baseCamTarget.z + panRef.current.y * 0.03,
      );
      camera.lookAt(lookTarget);
      camera.updateProjectionMatrix();
    };
    updateCamera();

    // ── Wheel zoom (smooth) ──────────────────────────────────────────
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const step = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY) * 0.001, 0.05);
      const next = Math.min(3, Math.max(0.3, zoomRef.current - step));
      setZoomRef.current(next);
    };
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    // ── Drag pan + click select (unified) ────────────────────────────
    let dragStart: { x: number; y: number; px: number; py: number } | null = null;
    let dragMoved = false;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragStart = { x: e.clientX, y: e.clientY, px: panRef.current.x, py: panRef.current.y };
      dragMoved = false;
      // Sync dragRef for OfficeSceneState
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panStartX: panRef.current.x,
        panStartY: panRef.current.y,
      };
    };
    const onPointerMove = (e: PointerEvent) => {
      // Hover detection (always)
      if (buddyGroupRef.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(mouseRef.current, camera);
        const hits = raycasterRef.current.intersectObjects(buddyGroupRef.current.children, true);
        let foundId: string | null = null;
        const first = hits[0];
        if (first) {
          let obj: THREE.Object3D | null = first.object;
          while (obj && !obj.userData.agentId) obj = obj.parent ?? null;
          if (obj && obj.userData.agentId) foundId = obj.userData.agentId;
        }
        hoveredIdRef.current = foundId;
      }
      // Drag pan
      if (!dragStart) {
        renderer.domElement.style.cursor = hoveredIdRef.current ? 'pointer' : 'grab';
        return;
      }
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
      if (dragMoved) {
        renderer.domElement.style.cursor = 'grabbing';
        setPanRef.current({ x: dragStart.px - dx * 0.08, y: dragStart.py - dy * 0.08 });
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (dragStart && !dragMoved) {
        // It was a click, not a drag — select buddy
        if (buddyGroupRef.current) {
          const rect = renderer.domElement.getBoundingClientRect();
          mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycasterRef.current.setFromCamera(mouseRef.current, camera);
          const hits = raycasterRef.current.intersectObjects(buddyGroupRef.current.children, true);
          const first = hits[0];
          if (first) {
            let obj: THREE.Object3D | null = first.object;
            while (obj && !obj.userData.agentId) obj = obj.parent ?? null;
            if (obj && obj.userData.agentId) onSelectAgent(obj.userData.agentId);
          }
        }
      }
      dragStart = null;
      dragRef.current = null;
      renderer.domElement.style.cursor = hoveredIdRef.current ? 'pointer' : 'grab';
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // ── Animation loop ──────────────────────────────────────────────
    let startTime = performance.now();
    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate);
      const elapsed = (performance.now() - startTime) / 1000;
      tickRef.current += 1;
      const frame = tickRef.current;

      // Billboard: rotate label/crown toward camera
      const camPos = camera.position;
      const worldTarget = new THREE.Vector3();
      for (const bs of buddyStatesRef.current) {
        bs.labelMesh.getWorldPosition(worldTarget);
        bs.labelMesh.lookAt(camPos.x, worldTarget.y, camPos.z);
        if (bs.crownMesh) {
          bs.crownMesh.getWorldPosition(worldTarget);
          bs.crownMesh.lookAt(camPos.x, worldTarget.y, camPos.z);
        }
      }

      // Projection screen slide animation
      const projScreen = projScreenRef.current;
      if (projScreen && projScreen.material instanceof THREE.MeshStandardMaterial) {
        slideTimerRef.current += 1;
        // Change slide every ~4 seconds (240 frames at 60fps)
        if (slideTimerRef.current >= 240) {
          slideTimerRef.current = 0;
          slideIdxRef.current = (slideIdxRef.current + 1) % OFFICE_PROJECTION_PAGE_COUNT;
          const slideIdx = slideIdxRef.current;
          const slideTex = createProjectionScreenTexture(buildDisplayData(elapsed), slideIdx);
          (projScreen.material as THREE.MeshStandardMaterial).map = slideTex;
          (projScreen.material as THREE.MeshStandardMaterial).emissive.set(0x334455);
          (projScreen.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3;
          projScreen.material.needsUpdate = true;
        }
      }

      // Human figure animation (status-aware)
      // Walking agents are handled separately; skip status animation for them
      for (const bs of buddyStatesRef.current) {
        if (bs.isWalking) continue;
        bs.tick += 1;
        const t = elapsed;
        const phase = bs.bobPhase;

        // Breathing (all states)
        const breathe = 1 + Math.sin(t * 2.5 + phase) * 0.015;
        bs.torsoMesh.scale.set(1, breathe, 1);

        if (bs.status === 'working') {
          // Typing: arms forward, small alternating keystroke motion
          const keystroke = Math.sin(t * 5 + phase) * 0.08;
          bs.leftArm.rotation.x = -Math.PI / 2.2 + keystroke;
          bs.leftArm.rotation.z = Math.PI / 6;
          bs.rightArm.rotation.x = -Math.PI / 2.2 - keystroke;
          bs.rightArm.rotation.z = -Math.PI / 6;
          // Head: slight look at screen, occasional glance away
          bs.headMesh.rotation.y = Math.sin(t * 0.3 + phase) * 0.06;
          bs.headMesh.rotation.x = -0.08; // looking slightly down at screen
          // Legs stay still (seated)
          bs.leftLegPivot.rotation.x = -Math.PI / 2;
          bs.rightLegPivot.rotation.x = -Math.PI / 2;
          // Subtle body sway
          const bob = Math.sin(t * 1.8 + phase) * 0.015;
          bs.bodyGroup.position.y = bs.baseY + bob;
        } else if (bs.status === 'discussing') {
          // Talking: one hand gestures, head turns to "listen/speak"
          const gesture = Math.sin(t * 2.0 + phase) * 0.25;
          bs.rightArm.rotation.x = -Math.PI / 2.5 + gesture;
          bs.rightArm.rotation.z = -Math.PI / 6 + Math.sin(t * 1.5 + phase) * 0.1;
          bs.leftArm.rotation.x = -Math.PI / 4;
          bs.leftArm.rotation.z = Math.PI / 10;
          // Head: animated talking / looking around
          bs.headMesh.rotation.y = Math.sin(t * 0.8 + phase) * 0.2;
          bs.headMesh.rotation.x = Math.sin(t * 1.2 + phase) * 0.05;
          // Occasional nod
          if (Math.sin(t * 0.4 + phase) > 0.8) {
            bs.headMesh.rotation.x = -0.15;
          }
          // Legs still (seated)
          bs.leftLegPivot.rotation.x = -Math.PI / 2;
          bs.rightLegPivot.rotation.x = -Math.PI / 2;
          const bob = Math.sin(t * 1.4 + phase) * 0.02;
          bs.bodyGroup.position.y = bs.baseY + bob;
        } else if (bs.status === 'resting') {
          // Relaxing: arms on lap, slow breathing, occasional stretch
          bs.leftArm.rotation.x = -Math.PI / 3 + Math.sin(t * 0.6 + phase) * 0.05;
          bs.leftArm.rotation.z = Math.PI / 8;
          bs.rightArm.rotation.x = -Math.PI / 3 + Math.sin(t * 0.6 + phase + 1) * 0.05;
          bs.rightArm.rotation.z = -Math.PI / 8;
          // Head: relaxed, slow look around
          bs.headMesh.rotation.y = Math.sin(t * 0.25 + phase) * 0.15;
          bs.headMesh.rotation.x = 0.05; // slight tilt back (relaxed)
          // Occasional yawn/stretch
          if (Math.sin(t * 0.15 + phase) > 0.92) {
            bs.rightArm.rotation.x = -Math.PI / 1.5; // stretch up
            bs.rightArm.rotation.z = -0.2;
            bs.headMesh.rotation.x = -0.2; // head back
          }
          // Legs: seated, one crossed over other occasionally
          bs.leftLegPivot.rotation.x = -Math.PI / 2;
          bs.rightLegPivot.rotation.x = -Math.PI / 2 + Math.sin(t * 0.2 + phase) * 0.1;
          const bob = Math.sin(t * 1.0 + phase) * 0.01;
          bs.bodyGroup.position.y = bs.baseY + bob;
        }

        // Hover: wave arm (overrides current pose)
        if (bs.isHovered) {
          bs.rightArm.rotation.x = -0.8 + Math.sin(t * 4) * 0.3;
          bs.rightArm.rotation.z = -0.3;
          bs.headMesh.rotation.x = 0; // look up
        }
      }

      // ── Walking animation for agents transitioning between zones ──────
      for (const bs of buddyStatesRef.current) {
        if (!bs.isWalking) continue;
        const parentGroup = bs.bodyGroup.parent as THREE.Group;
        const target = bs.walkWaypoints[bs.walkIdx];
        if (!target) {
          bs.isWalking = false;
          continue;
        }
        const dx = target.x - parentGroup.position.x;
        const dz = target.z - parentGroup.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 0.15) {
          // Reached waypoint
          if (target.isSeat) {
            // Snap to exact seat position and sit
            parentGroup.position.x = target.x;
            parentGroup.position.z = target.z;
            bs.bodyGroup.position.y = -0.45;
            bs.leftLegPivot.rotation.x = -Math.PI / 2;
            bs.rightLegPivot.rotation.x = -Math.PI / 2;
            // Apply sitting pose based on new status
            if (bs.status === 'resting') {
              bs.leftArm.rotation.x = -Math.PI / 3;
              bs.leftArm.rotation.z = Math.PI / 8;
              bs.rightArm.rotation.x = -Math.PI / 3;
              bs.rightArm.rotation.z = -Math.PI / 8;
            } else if (bs.status === 'discussing') {
              bs.leftArm.rotation.x = -Math.PI / 4;
              bs.leftArm.rotation.z = Math.PI / 10;
              bs.rightArm.rotation.x = -Math.PI / 2.5;
              bs.rightArm.rotation.z = -Math.PI / 6;
            } else {
              bs.leftArm.rotation.x = -Math.PI / 2.2;
              bs.leftArm.rotation.z = Math.PI / 6;
              bs.rightArm.rotation.x = -Math.PI / 2.2;
              bs.rightArm.rotation.z = -Math.PI / 6;
            }
            // Face the correct direction
            if (target.faceAngle !== undefined) {
              parentGroup.rotation.y = target.faceAngle + Math.PI;
            }
            bs.isWalking = false;
            bs.baseY = -0.45;
          }
          bs.walkIdx++;
          if (bs.walkIdx >= bs.walkWaypoints.length) {
            bs.isWalking = false;
          }
        } else {
          // Walk toward waypoint
          const step = Math.min(bs.walkSpeed, dist);
          const nx = (dx / dist) * step;
          const nz = (dz / dist) * step;
          parentGroup.position.x += nx;
          parentGroup.position.z += nz;
          // Face walking direction
          parentGroup.rotation.y = Math.atan2(-nx, -nz) + Math.PI;
          // Standing walking pose
          const walkCycle = Math.sin(elapsed * 8);
          bs.bodyGroup.position.y = Math.abs(walkCycle) * 0.04;
          bs.leftLegPivot.rotation.x = walkCycle * 0.4;
          bs.rightLegPivot.rotation.x = -walkCycle * 0.4;
          bs.leftArm.rotation.x = -walkCycle * 0.3;
          bs.rightArm.rotation.x = walkCycle * 0.3;
          bs.leftArm.rotation.z = Math.PI / 12;
          bs.rightArm.rotation.z = -Math.PI / 12;
          bs.headMesh.rotation.x = 0;
          bs.headMesh.rotation.y = 0;
        }
      }

      // Hover state update
      for (const bs of buddyStatesRef.current) {
        const agentId = bs.bodyGroup.parent?.userData.agentId;
        const wasHovered = bs.isHovered;
        bs.isHovered = agentId === hoveredIdRef.current;
        if (bs.isHovered !== wasHovered) {
          const agent = officeAgentsRef.current.find((a) => a.id === agentId);
          if (agent) {
            const lt = createLabelTexture(agent.label, bs.isSelected, bs.isHovered);
            (bs.labelMesh.material as THREE.MeshBasicMaterial).map = lt;
            (bs.labelMesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
          }
          // Shadow scale on hover
          const ss = bs.isHovered ? 1.3 : 1.0;
          bs.shadowDisc.scale.set(ss, ss, 1);
          // Hover glow on body
          const torsoMat = bs.torsoMesh.material as THREE.MeshStandardMaterial;
          if (bs.isHovered) {
            torsoMat.emissive = new THREE.Color(0x2244aa);
            torsoMat.emissiveIntensity = 0.4;
          } else {
            torsoMat.emissive = new THREE.Color(0x000000);
            torsoMat.emissiveIntensity = 0;
          }
        }
      }

      // Selection ring pulse + glow pillar
      for (const bs of buddyStatesRef.current) {
        if (bs.glowRing && bs.isSelected) {
          const pulse = 0.4 + Math.sin(elapsed * 3) * 0.3;
          (bs.glowRing.material as THREE.MeshBasicMaterial).opacity = pulse;
          const s = 1 + Math.sin(elapsed * 3) * 0.1;
          bs.glowRing.scale.set(s, 1, s);
        }
        if (bs.glowPillar && bs.isSelected) {
          const pillarPulse = 0.06 + Math.sin(elapsed * 2) * 0.04;
          (bs.glowPillar.material as THREE.MeshBasicMaterial).opacity = pillarPulse;
        }
      }

      // Monitor light flicker
      monitorLight.intensity = 0.6 + Math.sin(elapsed * 2) * 0.2;

      // Monitor texture update (real-time data)
      if (frame % 60 === 0) {
        const monMesh = monitorMeshRef.current;
        if (monMesh) {
          const mat = monMesh.material as THREE.MeshStandardMaterial;
          // Dispose old texture to prevent GPU memory leak
          if (mat.map) mat.map.dispose();
          const newTex = createMonitorTexture(buildDisplayData(elapsed));
          mat.map = newTex;
          mat.needsUpdate = true;
        }
      }

      // Dust drift
      const posAttr = dustGeo.getAttribute('position') as THREE.BufferAttribute;
      const posArr = posAttr.array as Float32Array;
      const ix = (i: number, c: number) => i * 3 + c;
      for (let i = 0; i < dustCount; i++) {
        const dv = dustVelocities[i]!;
        posArr[ix(i, 0)]! += dv.vx;
        posArr[ix(i, 1)]! += dv.vy;
        posArr[ix(i, 2)]! += dv.vz;
        if (posArr[ix(i, 1)]! > ROOM_H) {
          posArr[ix(i, 1)] = 0;
          posArr[ix(i, 0)] = (Math.random() - 0.5) * ROOM_W;
          posArr[ix(i, 2)] = (Math.random() - 0.5) * ROOM_D;
        }
      }
      posAttr.needsUpdate = true;
      dustMat.opacity = 0.15 + Math.sin(elapsed * 1.5) * 0.1;

      // Update camera from zoom/pan
      updateCamera();

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animIdRef.current);
      ro.disconnect();
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [buildDisplayData]);

  useEffect(() => {
    const elapsed = typeof performance === 'undefined' ? 0 : performance.now() / 1000;
    const displayData = buildDisplayData(elapsed);

    const monitorMesh = monitorMeshRef.current;
    if (monitorMesh?.material instanceof THREE.MeshStandardMaterial) {
      const material = monitorMesh.material;
      material.map?.dispose();
      material.map = createMonitorTexture(displayData);
      material.needsUpdate = true;
    }

    const projScreen = projScreenRef.current;
    if (projScreen?.material instanceof THREE.MeshStandardMaterial) {
      const material = projScreen.material;
      material.map?.dispose();
      material.map = createProjectionScreenTexture(displayData, slideIdxRef.current);
      material.emissive.set(0x334455);
      material.emissiveIntensity = 0.3;
      material.needsUpdate = true;
    }
  }, [
    activityStats,
    buildDisplayData,
    footerStats,
    metricCards,
    officeAgents,
    runtimeStatus,
    selectedSessionTitle,
    topSummary,
  ]);

  // ── Rebuild buddies when agents/selection change ────────────────────
  useEffect(() => {
    const group = buddyGroupRef.current;
    if (!group) return;

    // Save old positions/statuses for movement detection
    const oldPositions: Record<string, { x: number; z: number; status: string }> = {};
    for (const oldBs of buddyStatesRef.current) {
      const id = oldBs.bodyGroup.parent?.userData.agentId;
      if (id) {
        const pg = oldBs.bodyGroup.parent as THREE.Group;
        oldPositions[id] = { x: pg.position.x, z: pg.position.z, status: oldBs.status };
      }
    }

    while (group.children.length > 0) {
      const child = group.children[0]!;
      group.remove(child);
    }
    buddyStatesRef.current = [];

    for (const agent of officeAgents) {
      const { group: buddyGrp, state: bs } = createBuddy(agent, agent.id === selectedAgentId);
      group.add(buddyGrp);
      buddyStatesRef.current.push(bs);

      // Detect status change → initiate walking from old position
      const old = oldPositions[agent.id];
      if (old && old.status !== agent.status) {
        const fromZone =
          old.status === 'resting' ? 'rest' : old.status === 'discussing' ? 'discuss' : 'work';
        const toZone =
          agent.status === 'resting' ? 'rest' : agent.status === 'discussing' ? 'discuss' : 'work';
        const toSeats = SEAT_REGISTRY[toZone];
        const toIdx = hashStr(agent.id) % toSeats.length;
        const toSeat = toSeats[toIdx]!;
        const fromSeats = SEAT_REGISTRY[fromZone];
        const fromIdx = hashStr(agent.id) % fromSeats.length;
        const fromSeat = fromSeats[fromIdx]!;

        // Build waypoints for the transition
        const transitionWps = getTransitionWaypoints(fromZone, toZone, fromSeat, toSeat);
        const walkWaypoints = transitionWps.map((wp, i) => ({
          x: wp.x,
          z: wp.z,
          isSeat: i === transitionWps.length - 1, // only last waypoint is the seat
          faceAngle: i === transitionWps.length - 1 ? toSeat.faceAngle : undefined,
        }));

        // Set agent to old position and start walking
        const parentGroup = bs.bodyGroup.parent as THREE.Group;
        parentGroup.position.set(old.x, 0, old.z);
        bs.isWalking = true;
        bs.walkWaypoints = walkWaypoints;
        bs.walkIdx = 0;
        bs.walkSpeed = 0.05;
        // Stand up from sitting
        bs.bodyGroup.position.y = 0;
        bs.leftLegPivot.rotation.x = 0;
        bs.rightLegPivot.rotation.x = 0;
      }
    }
  }, [officeAgents, selectedAgentId, onSelectAgent]);

  const selectedAgent = officeAgentsRef.current.find((a) => a.id === selectedAgentId);
  const effectiveRuntimeStatus = resolveOfficeRuntimeStatus({
    runtimeStatus,
    statusLabel: topSummary.status,
  });
  const selectedAgentStatusTone = resolveOfficeAgentStatusTone({
    runtimeStatus: effectiveRuntimeStatus,
    agentStatus: selectedAgent?.status,
  });
  const selectedAgentStatusLabel = resolveOfficeAgentStatusLabel({
    runtimeStatus: effectiveRuntimeStatus,
    agentStatus: selectedAgent?.status,
  });
  const selectedAgentDotColor = resolveOfficeToneColor(selectedAgentStatusTone);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: 10,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        cursor: 'grab',
        touchAction: 'none',
        position: 'relative',
      }}
    >
      {/* Action button overlay — right side, vertically centered */}
      <div
        style={{
          position: 'absolute',
          right: 16,
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          alignItems: 'center',
          zIndex: 10,
          pointerEvents: 'auto',
        }}
      >
        {selectedAgent && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              alignItems: 'center',
              background: 'color-mix(in srgb, var(--bg-base) 88%, transparent)',
              border: `1px solid color-mix(in srgb, ${selectedAgentDotColor} 40%, transparent)`,
              borderRadius: 14,
              padding: '14px 12px',
              backdropFilter: 'blur(10px)',
              minWidth: 80,
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: 'var(--fg-strong)',
                fontWeight: 800,
                textAlign: 'center',
                lineHeight: 1.2,
              }}
            >
              {selectedAgent.label}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: selectedAgentDotColor,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: selectedAgentDotColor,
                  boxShadow:
                    selectedAgentStatusTone === 'warning' || selectedAgentStatusTone === 'muted'
                      ? 'none'
                      : `0 0 4px ${selectedAgentDotColor}`,
                }}
              />
              {selectedAgentStatusLabel}
            </span>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)', textAlign: 'center' }}>
              运行状态由团队执行链路驱动，不支持在 3D 场景中本地暂停单个角色。
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
