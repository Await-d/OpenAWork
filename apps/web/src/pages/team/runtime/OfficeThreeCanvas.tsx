import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { AgentTeamsOfficeAgent } from './team-runtime-reference-mock.js';
import { useTeamRuntimeReferenceViewData } from './team-runtime-reference-data.js';
import type { OfficeSceneState } from './OfficeScene.js';

// ── World units (meters) ─────────────────────────────────────────────
const ROOM_W = 16;
const ROOM_D = 9;
const ROOM_H = 3.2;

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
  isPaused: boolean;
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

// ── Texture helpers ──────────────────────────────────────────────────
function makeCanvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ── Wall texture (brick pattern) ──────────────────────────────────────
function createWallTexture(): THREE.CanvasTexture {
  const tw = 256,
    th = 64;
  return makeCanvasTexture(tw, th, (ctx) => {
    ctx.fillStyle = '#5d3a1a';
    ctx.fillRect(0, 0, tw, th);
    for (let row = 0; row < th; row += 8) {
      const off = (row / 8) % 2 === 0 ? 0 : 16;
      for (let col = off; col < tw; col += 32) {
        ctx.fillStyle = '#4a2e14';
        ctx.fillRect(col, row, 1, 8);
      }
      ctx.fillStyle = '#3e2510';
      ctx.fillRect(0, row, tw, 1);
    }
  });
}

// ── Floor texture (tile grid) ────────────────────────────────────────
function createFloorTexture(): THREE.CanvasTexture {
  const tw = 256,
    th = 256;
  return makeCanvasTexture(tw, th, (ctx) => {
    ctx.fillStyle = '#c2a06e';
    ctx.fillRect(0, 0, tw, th);
    ctx.fillStyle = '#a88850';
    for (let x = 0; x < tw; x += 16) ctx.fillRect(x, 0, 1, th);
    for (let y = 0; y < th; y += 16) ctx.fillRect(0, y, tw, 1);
  });
}

// ── Carpet texture ───────────────────────────────────────────────────
function createCarpetTexture(): THREE.CanvasTexture {
  const tw = 128,
    th = 128;
  return makeCanvasTexture(tw, th, (ctx) => {
    ctx.fillStyle = '#8b4562';
    ctx.fillRect(0, 0, tw, th);
    ctx.fillStyle = '#6b3050';
    for (let x = 0; x < tw; x += 8) ctx.fillRect(x, 0, 1, th);
    for (let y = 0; y < th; y += 8) ctx.fillRect(0, y, tw, 1);
    // Border pattern
    ctx.fillStyle = '#a05070';
    ctx.fillRect(0, 0, tw, 4);
    ctx.fillRect(0, th - 4, tw, 4);
    ctx.fillRect(0, 0, 4, th);
    ctx.fillRect(tw - 4, 0, 4, th);
  });
}

// ── Monitor screen texture ───────────────────────────────────────────
function createMonitorTexture(data: {
  topSummary: { title: string; memberCount: string; onlineCount: string; status: string };
  metricCards: { icon: string; label: string; value: string }[];
  footerStats: { label: string; value: string }[];
  officeAgents: { id: string; label: string; status: string }[];
  activityStats: Record<string, number>;
  elapsed: number;
}): THREE.CanvasTexture {
  const { topSummary, metricCards, footerStats, officeAgents, activityStats, elapsed } = data;
  const w = 384,
    h = 192;
  return makeCanvasTexture(w, h, (ctx) => {
    // Background
    ctx.fillStyle = '#0b1323';
    ctx.fillRect(0, 0, w, h);

    // Top bar
    ctx.fillStyle = '#5b8cff';
    ctx.fillRect(0, 0, w, 3);

    // Title line
    const sl = topSummary.status === '已暂停' ? 'PAUSED' : 'ACTIVE';
    const slColor = topSummary.status === '已暂停' ? '#f0883e' : '#3fb950';
    ctx.font = 'bold 16px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#5b8cff';
    const titleText =
      topSummary.title.length > 18 ? topSummary.title.slice(0, 18) + '…' : topSummary.title;
    ctx.fillText(`■ ${titleText}`, 10, 10);
    ctx.fillStyle = slColor;
    ctx.font = '12px ui-monospace, Menlo, monospace';
    ctx.fillText(`● ${sl}`, 310, 12);

    // Divider
    ctx.fillStyle = '#1c2d44';
    ctx.fillRect(0, 32, w, 1);

    // ── Left panel: 核心指标 ────────────────────────────────────────
    ctx.fillStyle = '#5b8cff';
    ctx.fillRect(10, 40, 4, 14);
    ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#8ab4ff';
    ctx.fillText('核心指标', 20, 41);

    // Metric cards (real data)
    ctx.font = '11px ui-monospace, Menlo, monospace';
    const metricY = 60;
    for (let i = 0; i < metricCards.length && i < 3; i++) {
      const mc = metricCards[i]!;
      ctx.fillStyle = '#8b949e';
      ctx.fillText(`${mc.label}`, 20, metricY + i * 16);
      ctx.fillStyle = '#e8eaed';
      ctx.font = 'bold 11px ui-monospace, Menlo, monospace';
      ctx.fillText(`${mc.value}`, 70, metricY + i * 16);
      ctx.font = '11px ui-monospace, Menlo, monospace';
    }

    // Footer stats (real data) as progress-style bars
    const barY = metricY + metricCards.length * 16 + 4;
    for (let i = 0; i < footerStats.length && i < 4; i++) {
      const fs = footerStats[i]!;
      const barColors = ['#5b8cff', '#3fb950', '#f0883e', '#ef5a5a'];
      const val = parseInt(fs.value, 10) || 0;
      const maxVal = Math.max(val, 1);
      const barW = Math.min(val * 8, 100);
      ctx.fillStyle = '#0f1f36';
      ctx.fillRect(20, barY + i * 14, 100, 8);
      ctx.fillStyle = barColors[i % barColors.length]!;
      ctx.fillRect(22, barY + i * 14 + 2, Math.max(2, barW), 4);
      ctx.fillStyle = '#8b949e';
      ctx.font = '9px ui-monospace, Menlo, monospace';
      ctx.fillText(`${fs.label} ${fs.value}`, 128, barY + i * 14 - 2);
    }

    // ── Right panel: Agent 状态 ─────────────────────────────────────
    const rx = 210;
    ctx.fillStyle = '#3fb950';
    ctx.fillRect(rx, 40, 4, 14);
    ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#7ee787';
    ctx.fillText('Agent 状态', rx + 10, 41);

    // Agent status list (real data)
    ctx.font = '10px ui-monospace, Menlo, monospace';
    const statusColors: Record<string, string> = {
      working: '#5b8cff',
      discussing: '#f0883e',
      resting: '#3fb950',
    };
    const statusLabels: Record<string, string> = { working: '💻', discussing: '💬', resting: '☕' };
    for (let i = 0; i < officeAgents.length && i < 6; i++) {
      const ag = officeAgents[i]!;
      const ay = 60 + i * 14;
      ctx.fillStyle = statusColors[ag.status] ?? '#8b949e';
      ctx.fillText(
        `${statusLabels[ag.status] ?? '?'} ${ag.label.length > 10 ? ag.label.slice(0, 10) : ag.label}`,
        rx + 10,
        ay,
      );
      ctx.fillStyle = '#8b949e';
      ctx.fillText(ag.status, rx + 110, ay);
    }

    // ── Bottom divider ─────────────────────────────────────────────
    ctx.fillStyle = '#1c2d44';
    ctx.fillRect(0, 130, w, 1);

    // ── Bottom: Activity stats ──────────────────────────────────────
    ctx.font = '10px ui-monospace, Menlo, monospace';
    const actEntries = Object.entries(activityStats).slice(0, 6);
    const actLabels: Record<string, string> = {
      session_start: '启动',
      thinking: '思考',
      file_read: '读文件',
      file_write: '写文件',
      tool_call: '工具',
      task_complete: '完成',
      assistant_message: '回复',
      command_exec: '执行',
      code_edit: '编辑',
      review: '评审',
    };
    let ax = 10;
    for (const [type, count] of actEntries) {
      const label = actLabels[type] ?? type.slice(0, 4);
      ctx.fillStyle = '#5b8cff';
      ctx.fillText(`${label}`, ax, 140);
      ctx.fillStyle = '#e8eaed';
      ctx.fillText(`${count}`, ax + 36, 140);
      ax += 62;
      if (ax > 350) break;
    }

    // Mini sparkline (activity pulse)
    ctx.strokeStyle = '#5b8cff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 20; i++) {
      const sx = 20 + i * 8;
      const sy = 175 - Math.sin(i * 0.5 + elapsed * 0.3) * 8;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    ctx.strokeStyle = '#3fb950';
    ctx.beginPath();
    for (let i = 0; i < 20; i++) {
      const sx = 200 + i * 8;
      const sy = 175 - Math.cos(i * 0.4 + elapsed * 0.2) * 6;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  });
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

// ── Label texture ────────────────────────────────────────────────────
function createLabelTexture(
  label: string,
  isSelected: boolean,
  isHovered: boolean,
): THREE.CanvasTexture {
  const cw = 10,
    ch = 12;
  const w = label.length * cw + 16;
  const h = ch + 10;
  return makeCanvasTexture(w, h, (ctx) => {
    ctx.fillStyle = '#000000';
    ctx.globalAlpha = 0.6;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = isHovered ? '#252540' : '#1a1c2c';
    ctx.fillRect(2, 2, w - 4, h - 4);
    if (isSelected) {
      ctx.fillStyle = '#5b8cff';
      ctx.fillRect(0, 0, w, 2);
      ctx.fillRect(0, h - 2, w, 2);
      ctx.fillRect(0, 0, 2, h);
      ctx.fillRect(w - 2, 0, 2, h);
    } else if (isHovered) {
      ctx.fillStyle = '#3a5cbf';
      ctx.fillRect(0, 0, w, 1);
      ctx.fillRect(0, h - 1, w, 1);
    }
    ctx.font = `${ch}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = isHovered ? '#5b8cff' : '#ffffff';
    ctx.fillText(label, 8, 5);
  });
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

// ── Direction constants for furniture / agent facing ───────────────────
// Convention: faceAngle describes where the PERSON faces (front direction).
//   In Three.js, rotation.y = θ rotates the local -z axis toward world direction:
//     local -z → world (-sin(θ), 0, -cos(θ))
//   So:
//     faceAngle = 0        → person faces -z (toward back wall)
//     faceAngle = π        → person faces +z (toward front)
//     faceAngle = -π/2     → person faces +x (toward right wall)
//     faceAngle = π/2      → person faces -x (toward left wall)
const FACE = {
  NEG_Z: 0, // face -z (toward back wall)
  POS_Z: Math.PI, // face +z (toward front / camera)
  POS_X: -Math.PI / 2, // face +x (toward right wall)
  NEG_X: Math.PI / 2, // face -x (toward left wall)
} as const;

// ── Reusable Chair component ──────────────────────────────────────────
// Creates an office chair with clear facing semantics.
//   faceAngle: direction the PERSON faces (see FACE constants).
//   Backrest is automatically placed BEHIND the person.
//   Returns the chair group (caller adds to scene if desired).
function createChairGroup(faceAngle: number): THREE.Group {
  const g = new THREE.Group();
  // Seat
  g.add(makeBox(0.4, 0.04, 0.4, COL.chair, 0, 0.45, 0, { roughness: 0.5, metalness: 0.3 }));
  // Backrest at local +z (behind person after rotation)
  g.add(makeBox(0.4, 0.4, 0.04, COL.chair, 0, 0.67, 0.18, { roughness: 0.5, metalness: 0.3 }));
  // Legs
  g.add(makeBox(0.04, 0.45, 0.04, COL.chairSeat, -0.16, 0.225, -0.16));
  g.add(makeBox(0.04, 0.45, 0.04, COL.chairSeat, 0.16, 0.225, -0.16));
  g.add(makeBox(0.04, 0.45, 0.04, COL.chairSeat, -0.16, 0.225, 0.16));
  g.add(makeBox(0.04, 0.45, 0.04, COL.chairSeat, 0.16, 0.225, 0.16));
  g.rotation.y = faceAngle;
  return g;
}

// Place a chair at (x, z) facing faceAngle direction, directly into scene
function addChair(scene: THREE.Scene, x: number, z: number, faceAngle: number) {
  const g = createChairGroup(faceAngle);
  g.position.set(x, 0, z);
  scene.add(g);
}

// ── Reusable Workstation component ────────────────────────────────────
// Creates a complete workstation: desk + monitor + keyboard + mouse + chair.
//   faceAngle: direction the PERSON faces (toward the monitor).
//   Monitor is placed IN FRONT of the person (faceAngle direction).
//   Chair is placed BEHIND the desk (opposite of faceAngle).
function addWorkstation(scene: THREE.Scene, x: number, z: number, faceAngle: number) {
  const dskW = 1.3,
    dskD = 0.65,
    dskH = 0.05;
  // Desk surface
  scene.add(makeBox(dskW, dskH, dskD, COL.desk, x, 0.72, z, { roughness: 0.6 }));
  scene.add(
    makeBox(dskW - 0.08, 0.01, dskD - 0.08, COL.deskTop, x, 0.75, z, {
      roughness: 0.4,
      metalness: 0.2,
    }),
  );
  // Desk legs
  for (const lx of [-dskW / 2 + 0.08, dskW / 2 - 0.08]) {
    for (const lz of [-dskD / 2 + 0.06, dskD / 2 - 0.06]) {
      scene.add(makeBox(0.05, 0.72, 0.05, COL.desk, x + lx, 0.36, z + lz));
    }
  }

  // Direction the person faces: (-sin(faceAngle), 0, -cos(faceAngle)) in world XZ
  const fx = -Math.sin(faceAngle);
  const fz = -Math.cos(faceAngle);
  // Monitor is in front of person (in faceAngle direction from desk center)
  const monX = x + fx * (dskD / 2 - 0.03);
  const monZ = z + fz * (dskD / 2 - 0.03);
  // Person/chair is behind the desk (opposite direction from monitor)
  const chairX = x - fx * 0.55;
  const chairZ = z - fz * 0.55;

  // Monitor screen (glowing, faces the person = faces opposite of faceAngle)
  const scrW = 0.46,
    scrH = 0.28;
  const scrGeo = new THREE.PlaneGeometry(scrW, scrH);
  const scrTex = makeCanvasTexture(160, 100, (ctx) => {
    ctx.fillStyle = '#0b1323';
    ctx.fillRect(0, 0, 160, 100);
    ctx.font = '5px ui-monospace, monospace';
    const lineColors = ['#5b8cff', '#3fb950', '#8b949e', '#f0883e', '#5b8cff', '#3fb950'];
    for (let row = 0; row < 12; row++) {
      const indent = row % 3 === 0 ? 8 : row % 3 === 1 ? 16 : 12;
      const lineW = 30 + Math.floor(Math.random() * 80);
      ctx.fillStyle = lineColors[row % lineColors.length]!;
      ctx.fillRect(indent, 8 + row * 7, lineW, 4);
    }
    ctx.fillStyle = '#5b8cff';
    ctx.fillRect(60, 50, 1, 6);
    ctx.fillStyle = '#1e2d40';
    ctx.fillRect(0, 0, 160, 6);
    ctx.fillStyle = '#ef5a5a';
    ctx.fillRect(4, 2, 3, 3);
    ctx.fillStyle = '#f0883e';
    ctx.fillRect(10, 2, 3, 3);
    ctx.fillStyle = '#3fb950';
    ctx.fillRect(16, 2, 3, 3);
  });
  const scrMat = new THREE.MeshStandardMaterial({
    map: scrTex,
    emissive: 0x112244,
    emissiveIntensity: 0.5,
    roughness: 0.3,
    metalness: 0.5,
  });
  const screen = new THREE.Mesh(scrGeo, scrMat);
  screen.position.set(monX, 0.96, monZ);
  // Screen faces the person (faces opposite of faceAngle = faceAngle + π)
  screen.rotation.y = faceAngle + Math.PI;
  scene.add(screen);
  // Monitor frame
  scene.add(
    makeBox(scrW + 0.04, scrH + 0.04, 0.02, COL.monitorFrame, monX, 0.96, monZ + fz * 0.005),
  );
  // Stand
  scene.add(makeBox(0.04, 0.18, 0.04, COL.monitorFrame, monX, 0.82, monZ + fz * 0.01));
  scene.add(makeBox(0.16, 0.02, 0.1, COL.monitorFrame, monX, 0.76, monZ + fz * 0.01));
  // Keyboard + mouse (on person's side of desk, between person and monitor)
  scene.add(
    makeBox(0.26, 0.012, 0.09, 0x2a2a3a, x - fx * 0.15, 0.76, z - fz * 0.15, { roughness: 0.8 }),
  );
  scene.add(
    makeBox(0.04, 0.012, 0.06, 0x2a2a3a, x - fx * 0.15 + 0.2, 0.76, z - fz * 0.15, {
      roughness: 0.8,
    }),
  );
  // Screen glow
  const dl = new THREE.PointLight(0x5b8cff, 0.2, 1.5);
  dl.position.set(x - fx * 0.3, 0.95, z - fz * 0.3);
  scene.add(dl);
  // Chair (person faces faceAngle)
  addChair(scene, chairX, chairZ, faceAngle);
}

// ── Build office scene ───────────────────────────────────────────────
function buildOffice(
  scene: THREE.Scene,
  monitorData: {
    topSummary: { title: string; memberCount: string; onlineCount: string; status: string };
    metricCards: { icon: string; label: string; value: string }[];
    footerStats: { label: string; value: string }[];
    officeAgents: { id: string; label: string; status: string }[];
    activityStats: Record<string, number>;
    elapsed: number;
  },
): { monitorMesh: THREE.Mesh; projScreen: THREE.Mesh } {
  // ── Floor ────────────────────────────────────────────────────────
  const floorTex = createFloorTexture();
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(4, 2);
  const floorGeo = new THREE.PlaneGeometry(ROOM_W, ROOM_D);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    roughness: 0.9,
    metalness: 0,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 0);
  floor.receiveShadow = true;
  scene.add(floor);

  // ── Wall-floor AO gradient (dark strip along wall base) ───────────
  function addAOStrip(w: number, d: number, x: number, z: number, rotY: number) {
    const aoTex = makeCanvasTexture(64, 16, (ctx) => {
      const grad = ctx.createLinearGradient(0, 0, 0, 16);
      grad.addColorStop(0, 'rgba(0,0,0,0.35)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 16);
    });
    aoTex.wrapS = THREE.RepeatWrapping;
    aoTex.repeat.set(w / 2, 1);
    const aoGeo = new THREE.PlaneGeometry(w, 0.4);
    const aoMat = new THREE.MeshBasicMaterial({
      map: aoTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.6,
    });
    const ao = new THREE.Mesh(aoGeo, aoMat);
    ao.rotation.x = -Math.PI / 2;
    ao.rotation.z = rotY;
    ao.position.set(x, 0.003, z);
    scene.add(ao);
  }
  addAOStrip(ROOM_W, 0.4, 0, -ROOM_D / 2 + 0.2, 0);
  addAOStrip(ROOM_W, 0.4, 0, ROOM_D / 2 - 0.2, 0);
  addAOStrip(ROOM_D, 0.4, -ROOM_W / 2 + 0.2, 0, Math.PI / 2);
  addAOStrip(ROOM_D, 0.4, ROOM_W / 2 - 0.2, 0, Math.PI / 2);

  // ── Back wall (z = -ROOM_D/2) ──────────────────────────────────────
  const wallTex = createWallTexture();
  wallTex.wrapS = THREE.RepeatWrapping;
  wallTex.repeat.set(2, 1);
  const wallGeo = new THREE.PlaneGeometry(ROOM_W, ROOM_H);
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex,
    roughness: 0.85,
    metalness: 0,
  });
  const backWall = new THREE.Mesh(wallGeo, wallMat);
  backWall.position.set(0, ROOM_H / 2, -ROOM_D / 2);
  backWall.receiveShadow = true;
  scene.add(backWall);

  // ── Left wall ──────────────────────────────────────────────────────
  const sideWallGeo = new THREE.PlaneGeometry(ROOM_D, ROOM_H);
  const leftWall = new THREE.Mesh(sideWallGeo, wallMat.clone());
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-ROOM_W / 2, ROOM_H / 2, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  // ── Right wall ─────────────────────────────────────────────────────
  const rightWall = new THREE.Mesh(sideWallGeo, wallMat.clone());
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(ROOM_W / 2, ROOM_H / 2, 0);
  rightWall.receiveShadow = true;
  scene.add(rightWall);

  // ── Baseboards ─────────────────────────────────────────────────────
  scene.add(makeBox(ROOM_W, 0.1, 0.05, COL.wallDark, 0, 0.05, -ROOM_D / 2 + 0.025));
  scene.add(makeBox(0.05, 0.1, ROOM_D, COL.wallDark, -ROOM_W / 2 + 0.025, 0.05, 0));
  scene.add(makeBox(0.05, 0.1, ROOM_D, COL.wallDark, ROOM_W / 2 - 0.025, 0.05, 0));

  // ── Unified floor tile texture ────────────────────────────────────
  const tileTex = makeCanvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#b8a88a';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#a09070';
    ctx.lineWidth = 1;
    for (let i = 0; i < 128; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 128);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(128, i);
      ctx.stroke();
    }
  });
  tileTex.wrapS = THREE.RepeatWrapping;
  tileTex.wrapT = THREE.RepeatWrapping;
  tileTex.repeat.set(4, 2);
  const tileFloorGeo = new THREE.PlaneGeometry(ROOM_W, ROOM_D);
  const tileFloorMat = new THREE.MeshStandardMaterial({
    map: tileTex,
    roughness: 0.8,
    metalness: 0.1,
  });
  const tileFloor = new THREE.Mesh(tileFloorGeo, tileFloorMat);
  tileFloor.rotation.x = -Math.PI / 2;
  tileFloor.position.set(0, 0.004, 0);
  tileFloor.receiveShadow = true;
  scene.add(tileFloor);

  // ── Rest zone carpet overlay (bottom-left, 70% of original quarter) ──
  const restW = (ROOM_W / 2) * 0.7;
  const restD = (ROOM_D / 2) * 0.7;
  const restCarpetTex = createCarpetTexture();
  const restCarpetGeo = new THREE.PlaneGeometry(restW, restD);
  const restCarpetMat = new THREE.MeshStandardMaterial({
    map: restCarpetTex,
    roughness: 0.95,
    metalness: 0,
  });
  const restCarpet = new THREE.Mesh(restCarpetGeo, restCarpetMat);
  restCarpet.rotation.x = -Math.PI / 2;
  restCarpet.position.set(-ROOM_W / 2 + restW / 2, 0.005, ROOM_D / 2 - restD / 2);
  restCarpet.receiveShadow = true;
  scene.add(restCarpet);

  // ── Floor Labels ──────────────────────────────────────────────────
  function addFloorLabel(text: string, x: number, z: number, color: string) {
    const cw = 8,
      ch = 10;
    const w = text.length * cw + 8;
    const h = ch + 6;
    const tex = makeCanvasTexture(w, h, (ctx) => {
      ctx.font = `${ch}px ui-monospace, Menlo, monospace`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = color;
      ctx.fillText(text, 4, 3);
    });
    const geo = new THREE.PlaneGeometry(w * 0.01, h * 0.01);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.006, z);
    scene.add(m);
  }
  addFloorLabel('☕ REST', -ROOM_W / 2 + restW / 2, ROOM_D / 2 - restD / 2, '#3fb950');
  // DISCUSS and WORK labels added after their zone definitions below

  // ── Glass walls around rest area (bottom-left, x<0, z>0) ────────
  const glassH = ROOM_H * 0.65;
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xaaccee,
    transparent: true,
    opacity: 0.2,
    roughness: 0.05,
    metalness: 0.8,
    side: THREE.DoubleSide,
  });
  // Helper: add a glass panel with metal frame
  function addGlassPanel(w: number, h: number, x: number, y: number, z: number, rotY: number) {
    const geo = new THREE.PlaneGeometry(w, h);
    const panel = new THREE.Mesh(geo, glassMat);
    panel.position.set(x, y, z);
    panel.rotation.y = rotY;
    scene.add(panel);
    // Frame: top beam
    const isZ = Math.abs(rotY) < 0.1 || Math.abs(rotY - Math.PI) < 0.1;
    if (isZ) {
      scene.add(
        makeBox(w, 0.04, 0.04, 0x8a8a9a, x, y + h / 2, z, { roughness: 0.3, metalness: 0.6 }),
      );
      scene.add(
        makeBox(0.04, h, 0.04, 0x8a8a9a, x - w / 2, y, z, { roughness: 0.3, metalness: 0.6 }),
      );
      scene.add(
        makeBox(0.04, h, 0.04, 0x8a8a9a, x + w / 2, y, z, { roughness: 0.3, metalness: 0.6 }),
      );
    } else {
      scene.add(
        makeBox(0.04, 0.04, w, 0x8a8a9a, x, y + h / 2, z, { roughness: 0.3, metalness: 0.6 }),
      );
      scene.add(
        makeBox(0.04, h, 0.04, 0x8a8a9a, x, y, z - w / 2, { roughness: 0.3, metalness: 0.6 }),
      );
      scene.add(
        makeBox(0.04, h, 0.04, 0x8a8a9a, x, y, z + w / 2, { roughness: 0.3, metalness: 0.6 }),
      );
    }
  }
  // Rest area boundaries: left=left wall, back=back wall; glass on: right (x=restRight), front (z=restFront)
  const restRight = -ROOM_W / 2 + restW; // right edge of rest area
  const restFront = ROOM_D / 2 - restD; // front edge of rest area
  // Right glass wall (x=restRight, from z=restFront to z=ROOM_D/2)
  addGlassPanel(restD, glassH, restRight, glassH / 2, restFront + restD / 2, Math.PI / 2);
  // Front glass wall (z=restFront, from x=-ROOM_W/2 to x=restRight) with door gap
  const doorGapW = 1.0;
  const frontSegW = restW - doorGapW;
  addGlassPanel(frontSegW, glassH, -ROOM_W / 2 + frontSegW / 2, glassH / 2, restFront, 0);
  // Door frame pillars
  scene.add(
    makeBox(0.06, glassH + 0.04, 0.06, 0x8a8a9a, restRight, glassH / 2 + 0.02, restFront, {
      roughness: 0.3,
      metalness: 0.6,
    }),
  );
  // Door top beam
  scene.add(
    makeBox(
      doorGapW + 0.08,
      0.06,
      0.06,
      0x8a8a9a,
      restRight - doorGapW / 2,
      glassH + 0.02,
      restFront,
      { roughness: 0.3, metalness: 0.6 },
    ),
  );

  // ── Rest Zone: Sofa & Coffee Table (bottom-left, x<0, z>0) ────
  const sofaX = -ROOM_W / 2 + 0.5,
    sofaZ = ROOM_D / 2 - restD / 2;
  // Sofa (against left wall, scaled for smaller rest area)
  const sofaLen = restD * 0.7;
  scene.add(makeBox(0.7, 0.3, sofaLen, 0x4a6a5a, sofaX, 0.25, sofaZ, { roughness: 0.8 }));
  scene.add(makeBox(0.12, 0.45, sofaLen, 0x4a6a5a, sofaX - 0.35, 0.47, sofaZ, { roughness: 0.8 }));
  scene.add(
    makeBox(0.12, 0.35, 0.7, 0x4a6a5a, sofaX, 0.33, sofaZ - sofaLen / 2 + 0.35, { roughness: 0.8 }),
  );
  scene.add(
    makeBox(0.12, 0.35, 0.7, 0x4a6a5a, sofaX, 0.33, sofaZ + sofaLen / 2 - 0.35, { roughness: 0.8 }),
  );
  // Coffee table
  scene.add(makeBox(0.5, 0.05, 0.8, COL.desk, sofaX + 0.7, 0.4, sofaZ, { roughness: 0.5 }));
  scene.add(makeBox(0.06, 0.38, 0.06, COL.desk, sofaX + 0.7 - 0.18, 0.19, sofaZ - 0.3));
  scene.add(makeBox(0.06, 0.38, 0.06, COL.desk, sofaX + 0.7 - 0.18, 0.19, sofaZ + 0.3));
  scene.add(makeBox(0.06, 0.38, 0.06, COL.desk, sofaX + 0.7 + 0.18, 0.19, sofaZ - 0.3));
  scene.add(makeBox(0.06, 0.38, 0.06, COL.desk, sofaX + 0.7 + 0.18, 0.19, sofaZ + 0.3));

  // ── Discussion Zone: Conference table (bottom, centered in freed space) ──
  const tableW = 4.0,
    tableH = 0.08,
    tableD = 1.8;
  const tableX = 2.0,
    tableZ = 2.5;
  scene.add(
    makeBox(tableW, tableH, tableD, 0x6e5a3e, tableX, 0.75, tableZ, {
      roughness: 0.4,
      metalness: 0.15,
    }),
  );
  // Table legs (metal)
  for (const dx of [-tableW / 2 + 0.15, tableW / 2 - 0.15]) {
    for (const dz of [-tableD / 2 + 0.12, tableD / 2 - 0.12]) {
      scene.add(
        makeBox(0.05, 0.75, 0.05, 0x8a8a9a, tableX + dx, 0.375, tableZ + dz, {
          roughness: 0.3,
          metalness: 0.6,
        }),
      );
    }
  }
  // Projector on table (small device near center)
  scene.add(
    makeBox(0.25, 0.08, 0.2, 0x3a3a4a, tableX, 0.82, tableZ, { roughness: 0.3, metalness: 0.5 }),
  );
  // Projector lens (glowing dot)
  const projLens = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x88aaff, emissiveIntensity: 1.5 }),
  );
  projLens.position.set(tableX + 0.1, 0.86, tableZ);
  scene.add(projLens);
  // Projector light beam (cone from projector to screen on right wall)
  const projSpot = new THREE.SpotLight(0xaaccff, 3, 6, Math.PI / 8, 0.5, 1);
  projSpot.position.set(tableX + 0.1, 0.88, tableZ);
  projSpot.target.position.set(ROOM_W / 2 - 0.05, 1.9, tableZ);
  scene.add(projSpot);
  scene.add(projSpot.target);
  // Light cone visual (volumetric beam)
  const beamLen = ROOM_W / 2 - tableX - 0.1;
  const beamGeo = new THREE.ConeGeometry(0.6, beamLen, 16, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xaaccff,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(tableX + 0.1 + beamLen / 2, 1.38, tableZ);
  beam.rotation.z = Math.PI / 2;
  scene.add(beam);
  // Projection screen on right wall (facing the table)
  const screenW = 2.4,
    screenH = 1.6;
  const screenGeo = new THREE.PlaneGeometry(screenW, screenH);
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0xf0f0f0,
    emissive: 0x222233,
    emissiveIntensity: 0.15,
    roughness: 0.9,
    metalness: 0,
  });
  const projScreen = new THREE.Mesh(screenGeo, screenMat);
  projScreen.rotation.y = -Math.PI / 2;
  projScreen.position.set(ROOM_W / 2 - 0.03, 1.9, tableZ);
  scene.add(projScreen);
  // Screen frame
  scene.add(
    makeBox(0.04, screenH + 0.08, screenW + 0.08, 0x5a5a6a, ROOM_W / 2 - 0.01, 1.9, tableZ, {
      roughness: 0.4,
      metalness: 0.3,
    }),
  );
  // Store projection screen ref for animation
  const projScreenRef = projScreen;

  // Discussion chairs: leader sits at left end of table
  // Left end (head of table): leader faces +x (toward table center)
  addChair(scene, tableX - tableW / 2 - 0.6, tableZ, FACE.POS_X);
  // Front side chairs (z < tableZ): person faces +z toward table
  for (let i = -1.5; i <= 1.5; i++) {
    addChair(scene, tableX + i * 1.0, tableZ - 1.2, FACE.POS_Z);
  }
  // Back side chairs (z > tableZ): person faces -z toward table
  for (let i = -1.5; i <= 1.5; i++) {
    addChair(scene, tableX + i * 1.0, tableZ + 1.2, FACE.NEG_Z);
  }
  addFloorLabel('💬 DISCUSS', tableX, tableZ - tableD / 2 - 0.3, '#f0883e');

  // ── Work Zone: Realistic desk rows (z < 0) ──────────────────────
  // Two rows of 6 workstations facing each other with a center aisle
  const aisleZ = -2.2;
  const rowOffset = 1.8;
  const wsXs = [-6.5, -3.9, -1.3, 1.3, 3.9, 6.5];
  // Row 1: near back wall, person faces -z (toward back wall, monitor against wall)
  for (const wx of wsXs) {
    addWorkstation(scene, wx, aisleZ - rowOffset, FACE.NEG_Z);
  }
  // Row 2: near center, person faces -z (toward back wall / monitor in front)
  for (const wx of wsXs) {
    addWorkstation(scene, wx, aisleZ + rowOffset, FACE.NEG_Z);
  }
  addFloorLabel('💻 WORK', 0, aisleZ + 0.5, '#5b8cff');

  // ── Large wall monitor (back wall) ──────────────────────────────
  const monW = 3.6,
    monH = 1.8;
  const monGeo = new THREE.PlaneGeometry(monW, monH);
  const monTex = createMonitorTexture(monitorData);
  const monMat = new THREE.MeshStandardMaterial({
    map: monTex,
    emissive: 0x112244,
    emissiveIntensity: 0.4,
    roughness: 0.3,
    metalness: 0.5,
  });
  const monitor = new THREE.Mesh(monGeo, monMat);
  monitor.position.set(0, 1.9, -ROOM_D / 2 + 0.02);
  scene.add(monitor);
  // Frame
  scene.add(makeBox(monW + 0.14, monH + 0.14, 0.08, COL.monitorFrame, 0, 1.9, -ROOM_D / 2 + 0.01));
  // Monitor stand
  scene.add(makeBox(0.08, 0.5, 0.08, COL.monitorFrame, 0, 0.5, -ROOM_D / 2 + 0.1));
  scene.add(makeBox(0.6, 0.04, 0.3, COL.monitorFrame, 0, 0.25, -ROOM_D / 2 + 0.15));

  // ── Whiteboard on right wall removed (replaced by projection screen) ──

  // ── Windows ─────────────────────────────────────────────────────
  function addWindow(x: number, y: number, w: number, h: number) {
    const winGeo = new THREE.PlaneGeometry(w, h);
    const winMat = new THREE.MeshStandardMaterial({
      color: COL.window,
      emissive: 0x3a6080,
      emissiveIntensity: 0.4,
      roughness: 0.1,
      metalness: 0.8,
      transparent: true,
      opacity: 0.7,
    });
    const win = new THREE.Mesh(winGeo, winMat);
    win.position.set(x, y, -ROOM_D / 2 + 0.015);
    scene.add(win);
    scene.add(makeBox(w + 0.08, 0.04, 0.04, COL.windowFrame, x, y + h / 2, -ROOM_D / 2 + 0.02));
    scene.add(makeBox(w + 0.08, 0.04, 0.04, COL.windowFrame, x, y - h / 2, -ROOM_D / 2 + 0.02));
    scene.add(makeBox(0.04, h + 0.08, 0.04, COL.windowFrame, x - w / 2, y, -ROOM_D / 2 + 0.02));
    scene.add(makeBox(0.04, h + 0.08, 0.04, COL.windowFrame, x + w / 2, y, -ROOM_D / 2 + 0.02));
    scene.add(makeBox(w, 0.03, 0.02, COL.windowFrame, x, y, -ROOM_D / 2 + 0.025));
    scene.add(makeBox(0.03, h, 0.02, COL.windowFrame, x, y, -ROOM_D / 2 + 0.025));
  }
  addWindow(-5.5, 2.0, 1.2, 0.8);
  addWindow(5.5, 2.0, 1.2, 0.8);

  // ── Safety sign ─────────────────────────────────────────────────
  const signGeo = new THREE.PlaneGeometry(0.6, 0.4);
  const signMat = new THREE.MeshStandardMaterial({
    color: COL.sign,
    emissive: 0x806020,
    emissiveIntensity: 0.15,
    roughness: 0.6,
  });
  const signMesh = new THREE.Mesh(signGeo, signMat);
  signMesh.position.set(3.5, 2.2, -ROOM_D / 2 + 0.015);
  scene.add(signMesh);
  scene.add(makeBox(0.64, 0.44, 0.03, COL.signBorder, 3.5, 2.2, -ROOM_D / 2 + 0.005));

  // ── Plants ──────────────────────────────────────────────────────
  function addPlant(x: number, z: number, scale = 1) {
    const s = scale;
    scene.add(makeBox(0.2 * s, 0.25 * s, 0.2 * s, COL.plantPot, x, 0.125 * s, z));
    const foliage = new THREE.Mesh(
      new THREE.SphereGeometry(0.25 * s, 8, 6),
      new THREE.MeshStandardMaterial({ color: COL.plant, roughness: 0.9 }),
    );
    foliage.position.set(x, 0.45 * s, z);
    foliage.castShadow = true;
    scene.add(foliage);
  }
  addPlant(-7.2, -2.0);
  addPlant(7.2, -2.0);
  addPlant(-7.2, 3.8, 0.8);
  addPlant(7.2, 3.8, 1.3);

  // ── Bookshelf (rest zone, left wall) ────────────────────────────
  const shelfX = -ROOM_W / 2 + 0.2,
    shelfZ = restFront + 0.5;
  scene.add(
    makeBox(0.3, 1.2, 0.8, COL.shelf, shelfX, 0.6, shelfZ, { roughness: 0.5, metalness: 0.3 }),
  );
  for (const sy of [0.3, 0.6, 0.9]) {
    scene.add(makeBox(0.32, 0.03, 0.82, COL.shelfBook, shelfX, sy, shelfZ));
  }
  // Books
  const bookColors = [0xa4c4d8, 0xd8a4a4, 0xa4d8a4, 0xd8d8a4, 0xc4a4d8];
  for (let i = 0; i < 5; i++) {
    scene.add(
      makeBox(0.08, 0.2, 0.15, bookColors[i]!, shelfX, 0.42 + i * 0.04, shelfZ - 0.25 + i * 0.12),
    );
  }

  // ── Power bar (rest zone) ───────────────────────────────────────
  scene.add(makeBox(0.15, 0.4, 0.1, COL.desk, 6.5, 0.2, 3.8));
  const ledRed = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 6, 4),
    new THREE.MeshStandardMaterial({
      color: COL.danger,
      emissive: COL.danger,
      emissiveIntensity: 2,
    }),
  );
  ledRed.position.set(6.5, 0.12, 3.85);
  scene.add(ledRed);
  const ledBlue = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 6, 4),
    new THREE.MeshStandardMaterial({
      color: COL.accent,
      emissive: COL.accent,
      emissiveIntensity: 2,
    }),
  );
  ledBlue.position.set(6.5, 0.25, 3.85);
  scene.add(ledBlue);

  // ── Coffee cups on desks ────────────────────────────────────────
  function addCoffeeCup(x: number, y: number, z: number) {
    const cupGeo = new THREE.CylinderGeometry(0.03, 0.025, 0.06, 8);
    const cupMat = new THREE.MeshStandardMaterial({ color: COL.coffee, roughness: 0.5 });
    const cup = new THREE.Mesh(cupGeo, cupMat);
    cup.position.set(x, y, z);
    cup.castShadow = true;
    scene.add(cup);
    // Handle
    const handleGeo = new THREE.TorusGeometry(0.02, 0.005, 6, 8, Math.PI);
    const handleMat = new THREE.MeshStandardMaterial({ color: COL.coffeeHandle, roughness: 0.5 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(x + 0.035, y, z);
    handle.rotation.y = Math.PI / 2;
    scene.add(handle);
  }
  addCoffeeCup(-4.5, 0.42, 3.2);
  addCoffeeCup(6.5, 0.78, -3.0);
  addCoffeeCup(4.0, 0.81, 2.0);
  addCoffeeCup(3.0, 0.78, -ROOM_D / 2 + 0.6);

  return { monitorMesh: monitor, projScreen: projScreenRef };
}

// ── Create buddy (3D human figure) ─────────────────────────────────────
function createBuddy(
  agent: AgentTeamsOfficeAgent,
  isSelected: boolean,
  isPaused: boolean,
): { group: THREE.Group; state: BuddyState } {
  const group = new THREE.Group();
  const bodyColor = isPaused ? 0xf0883e : pickAgentColor(agent.id, BODY_COLORS);
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

  // Opacity for paused
  if (isPaused) {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
        child.material.transparent = true;
        child.material.opacity = Math.min(child.material.opacity, 0.5);
      }
    });
  }

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
    isPaused,
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
  onSelectAgent,
  state,
}: {
  selectedAgentId: string;
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
  const { officeAgents, metricCards, topSummary, footerStats, activityStats } =
    useTeamRuntimeReferenceViewData();
  const officeAgentsRef = useRef<AgentTeamsOfficeAgent[]>([]);
  const metricCardsRef = useRef(metricCards);
  const topSummaryRef = useRef(topSummary);
  const footerStatsRef = useRef(footerStats);
  const activityStatsRef = useRef(activityStats);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const setZoomRef = useRef<React.Dispatch<React.SetStateAction<number>>>(() => {});
  const setPanRef = useRef<React.Dispatch<React.SetStateAction<{ x: number; y: number }>>>(
    () => {},
  );
  const { zoom, setZoom, pan, setPan, dragRef } = state;

  // Keep refs in sync for animation loop / event handler access
  officeAgentsRef.current = officeAgents;
  metricCardsRef.current = metricCards;
  topSummaryRef.current = topSummary;
  footerStatsRef.current = footerStats;
  activityStatsRef.current = activityStats;
  zoomRef.current = zoom;
  panRef.current = pan;
  setZoomRef.current = setZoom;
  setPanRef.current = setPan;

  // ── Initialize Three.js scene ──────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setClearColor(COL.bg, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    const { monitorMesh, projScreen } = buildOffice(scene, {
      topSummary,
      metricCards,
      footerStats,
      officeAgents: officeAgentsRef.current,
      activityStats,
      elapsed: 0,
    });
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
    const clock = new THREE.Clock();
    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
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
          slideIdxRef.current = (slideIdxRef.current + 1) % 6;
          const slideIdx = slideIdxRef.current;
          const slideTex = makeCanvasTexture(320, 200, (ctx) => {
            // Slide background
            const bgColors = ['#1a2744', '#2a1a44', '#1a4427', '#443a1a', '#441a2a', '#1a3a44'];
            ctx.fillStyle = bgColors[slideIdx]!;
            ctx.fillRect(0, 0, 320, 200);
            // Title bar
            ctx.fillStyle = '#5b8cff';
            ctx.fillRect(0, 0, 320, 36);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 16px ui-monospace, sans-serif';
            const titles = [
              'Q3 Roadmap',
              'Sprint Review',
              'Team Metrics',
              'Risk Analysis',
              'Action Items',
              'Next Steps',
            ];
            ctx.fillText(titles[slideIdx]!, 16, 24);
            // Content lines
            ctx.font = '10px ui-monospace, monospace';
            const contentColors = [
              '#3fb950',
              '#f0883e',
              '#8b949e',
              '#5b8cff',
              '#ef5a5a',
              '#3fb950',
            ];
            for (let row = 0; row < 8; row++) {
              const lineW = 40 + Math.floor(Math.random() * 200);
              ctx.fillStyle = contentColors[(slideIdx + row) % contentColors.length]!;
              ctx.fillRect(16, 50 + row * 18, lineW, 8);
            }
            // Chart placeholder
            ctx.fillStyle = '#3a4a6a';
            ctx.fillRect(200, 50, 100, 80);
            // Chart bars
            const barColors = ['#5b8cff', '#3fb950', '#f0883e'];
            for (let b = 0; b < 3; b++) {
              const bh = 20 + Math.floor(Math.random() * 50);
              ctx.fillStyle = barColors[b]!;
              ctx.fillRect(210 + b * 30, 130 - bh, 20, bh);
            }
            // Page indicator
            ctx.fillStyle = '#8b949e';
            ctx.font = '8px ui-monospace, monospace';
            ctx.fillText(`${slideIdx + 1} / 6`, 270, 190);
          });
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
          const agents = officeAgentsRef.current;
          const newTex = createMonitorTexture({
            topSummary: topSummaryRef.current,
            metricCards: metricCardsRef.current,
            footerStats: footerStatsRef.current,
            officeAgents: agents,
            activityStats: activityStatsRef.current,
            elapsed,
          });
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
  }, []);

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
      const { group: buddyGrp, state: bs } = createBuddy(
        agent,
        agent.id === selectedAgentId,
        state.agentPaused.has(agent.id),
      );
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
  }, [officeAgents, selectedAgentId, state.agentPaused, onSelectAgent]);

  const { agentPaused, toggleAgentPause } = state;
  const selectedAgent = officeAgentsRef.current.find((a) => a.id === selectedAgentId);
  const isPaused = selectedAgent ? agentPaused.has(selectedAgent.id) : false;

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: 10,
        border: '1px solid var(--border-subtle)',
        background: '#1a1c2c',
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
              background: 'rgba(26, 28, 44, 0.88)',
              border: `1px solid ${isPaused ? 'rgba(239, 90, 90, 0.4)' : 'rgba(63, 185, 80, 0.4)'}`,
              borderRadius: 14,
              padding: '14px 12px',
              backdropFilter: 'blur(10px)',
              minWidth: 80,
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: 'var(--text)',
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
                color: isPaused ? 'var(--warning)' : 'var(--success)',
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
                  background: isPaused ? 'var(--warning)' : 'var(--success)',
                  boxShadow: isPaused ? 'none' : '0 0 4px var(--success)',
                }}
              />
              {isPaused ? '已暂停' : '运行中'}
            </span>
            <button
              type="button"
              onClick={() => toggleAgentPause(selectedAgent.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 10,
                border: isPaused
                  ? '1px solid color-mix(in oklch, var(--success) 50%, transparent)'
                  : '1px solid color-mix(in oklch, var(--warning) 50%, transparent)',
                background: isPaused
                  ? 'color-mix(in oklch, var(--success) 15%, var(--bg))'
                  : 'color-mix(in oklch, var(--warning) 15%, var(--bg))',
                color: isPaused ? 'var(--success)' : 'var(--warning)',
                fontSize: 14,
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.15s',
                minWidth: 60,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              {isPaused ? '▶ 恢复' : '⏸ 暂停'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
