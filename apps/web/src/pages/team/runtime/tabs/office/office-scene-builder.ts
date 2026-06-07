import * as THREE from 'three';
import type { OfficeCanvasDisplayData } from './office-canvas-textures.js';
import {
  createCarpetTexture,
  createFloorTexture,
  createMonitorTexture,
  createProjectionScreenTexture,
  createWallTexture,
  makeCanvasTexture,
} from './office-canvas-textures.js';

const ROOM_W = 16;
const ROOM_D = 9;
const ROOM_H = 3.2;

const COL = {
  wall: 0x5d3a1a,
  wallDark: 0x3e2510,
  floor: 0xc2a06e,
  desk: 0x8b6234,
  deskTop: 0xa07844,
  chair: 0x6e7a8a,
  chairSeat: 0x4a5a6a,
  plant: 0x3fad4f,
  plantPot: 0x6e4a2e,
  shelf: 0x6e7a8a,
  shelfBook: 0xa4c4d8,
  monitorFrame: 0x1e2d40,
  window: 0x7ec8e3,
  windowFrame: 0x3e5464,
  sign: 0xf0d878,
  signBorder: 0x8d4c17,
  carpetDark: 0x6b3050,
  coffee: 0xf5e6d0,
  coffeeHandle: 0xd4c4b0,
  accent: 0x5b8cff,
  danger: 0xf85149,
} as const;

const FACE = {
  NEG_Z: 0,
  POS_Z: Math.PI,
  POS_X: -Math.PI / 2,
} as const;

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

function createChairGroup(faceAngle: number): THREE.Group {
  const group = new THREE.Group();
  group.add(makeBox(0.4, 0.04, 0.4, COL.chair, 0, 0.45, 0, { roughness: 0.5, metalness: 0.3 }));
  group.add(makeBox(0.4, 0.4, 0.04, COL.chair, 0, 0.67, 0.18, { roughness: 0.5, metalness: 0.3 }));
  group.add(makeBox(0.04, 0.45, 0.04, COL.chairSeat, -0.16, 0.225, -0.16));
  group.add(makeBox(0.04, 0.45, 0.04, COL.chairSeat, 0.16, 0.225, -0.16));
  group.add(makeBox(0.04, 0.45, 0.04, COL.chairSeat, -0.16, 0.225, 0.16));
  group.add(makeBox(0.04, 0.45, 0.04, COL.chairSeat, 0.16, 0.225, 0.16));
  group.rotation.y = faceAngle;
  return group;
}

function addChair(scene: THREE.Scene, x: number, z: number, faceAngle: number): void {
  const chair = createChairGroup(faceAngle);
  chair.position.set(x, 0, z);
  scene.add(chair);
}

function addWorkstation(scene: THREE.Scene, x: number, z: number, faceAngle: number): void {
  const deskWidth = 1.3;
  const deskDepth = 0.65;
  const deskHeight = 0.05;

  scene.add(makeBox(deskWidth, deskHeight, deskDepth, COL.desk, x, 0.72, z, { roughness: 0.6 }));
  scene.add(
    makeBox(deskWidth - 0.08, 0.01, deskDepth - 0.08, COL.deskTop, x, 0.75, z, {
      roughness: 0.4,
      metalness: 0.2,
    }),
  );

  for (const legX of [-deskWidth / 2 + 0.08, deskWidth / 2 - 0.08]) {
    for (const legZ of [-deskDepth / 2 + 0.06, deskDepth / 2 - 0.06]) {
      scene.add(makeBox(0.05, 0.72, 0.05, COL.desk, x + legX, 0.36, z + legZ));
    }
  }

  const fx = -Math.sin(faceAngle);
  const fz = -Math.cos(faceAngle);
  const monitorX = x + fx * (deskDepth / 2 - 0.03);
  const monitorZ = z + fz * (deskDepth / 2 - 0.03);
  const chairX = x - fx * 0.55;
  const chairZ = z - fz * 0.55;

  const screenGeo = new THREE.PlaneGeometry(0.46, 0.28);
  const screenTexture = makeCanvasTexture(160, 100, (ctx) => {
    ctx.fillStyle = '#0b1323';
    ctx.fillRect(0, 0, 160, 100);
    const lineColors = ['#3aa0ff', '#16a34a', '#7b8a9e', '#f0b429', '#3aa0ff', '#16a34a'];
    for (let row = 0; row < 12; row += 1) {
      const indent = row % 3 === 0 ? 8 : row % 3 === 1 ? 16 : 12;
      const lineWidth = 30 + Math.floor(Math.random() * 80);
      ctx.fillStyle = lineColors[row % lineColors.length]!;
      ctx.fillRect(indent, 8 + row * 7, lineWidth, 4);
    }
    ctx.fillStyle = '#3aa0ff';
    ctx.fillRect(60, 50, 1, 6);
    ctx.fillStyle = '#1e2d40';
    ctx.fillRect(0, 0, 160, 6);
    ctx.fillStyle = '#e0497a';
    ctx.fillRect(4, 2, 3, 3);
    ctx.fillStyle = '#f0b429';
    ctx.fillRect(10, 2, 3, 3);
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(16, 2, 3, 3);
  });

  const screenMat = new THREE.MeshStandardMaterial({
    map: screenTexture,
    emissive: 0x112244,
    emissiveIntensity: 0.5,
    roughness: 0.3,
    metalness: 0.5,
  });
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(monitorX, 0.96, monitorZ);
  screen.rotation.y = faceAngle + Math.PI;
  scene.add(screen);

  scene.add(makeBox(0.5, 0.32, 0.02, COL.monitorFrame, monitorX, 0.96, monitorZ + fz * 0.005));
  scene.add(makeBox(0.04, 0.18, 0.04, COL.monitorFrame, monitorX, 0.82, monitorZ + fz * 0.01));
  scene.add(makeBox(0.16, 0.02, 0.1, COL.monitorFrame, monitorX, 0.76, monitorZ + fz * 0.01));
  scene.add(
    makeBox(0.26, 0.012, 0.09, 0x2a2a3a, x - fx * 0.15, 0.76, z - fz * 0.15, { roughness: 0.8 }),
  );
  scene.add(
    makeBox(0.04, 0.012, 0.06, 0x2a2a3a, x - fx * 0.15 + 0.2, 0.76, z - fz * 0.15, {
      roughness: 0.8,
    }),
  );

  const deskLight = new THREE.PointLight(0x5b8cff, 0.2, 1.5);
  deskLight.position.set(x - fx * 0.3, 0.95, z - fz * 0.3);
  scene.add(deskLight);

  addChair(scene, chairX, chairZ, faceAngle);
}

export function buildOffice(
  scene: THREE.Scene,
  monitorData: OfficeCanvasDisplayData,
): { monitorMesh: THREE.Mesh; projScreen: THREE.Mesh } {
  const floorTex = createFloorTexture();
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(4, 2);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  function addAOStrip(w: number, x: number, z: number, rotZ: number): void {
    const aoTex = makeCanvasTexture(64, 16, (ctx) => {
      const grad = ctx.createLinearGradient(0, 0, 0, 16);
      grad.addColorStop(0, 'rgba(0,0,0,0.35)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 16);
    });
    aoTex.wrapS = THREE.RepeatWrapping;
    aoTex.repeat.set(w / 2, 1);
    const ao = new THREE.Mesh(
      new THREE.PlaneGeometry(w, 0.4),
      new THREE.MeshBasicMaterial({
        map: aoTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.6,
      }),
    );
    ao.rotation.x = -Math.PI / 2;
    ao.rotation.z = rotZ;
    ao.position.set(x, 0.003, z);
    scene.add(ao);
  }

  addAOStrip(ROOM_W, 0, -ROOM_D / 2 + 0.2, 0);
  addAOStrip(ROOM_W, 0, ROOM_D / 2 - 0.2, 0);
  addAOStrip(ROOM_D, -ROOM_W / 2 + 0.2, 0, Math.PI / 2);
  addAOStrip(ROOM_D, ROOM_W / 2 - 0.2, 0, Math.PI / 2);

  const wallTex = createWallTexture();
  wallTex.wrapS = THREE.RepeatWrapping;
  wallTex.repeat.set(2, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, metalness: 0 });

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), wallMat);
  backWall.position.set(0, ROOM_H / 2, -ROOM_D / 2);
  backWall.receiveShadow = true;
  scene.add(backWall);

  const sideWallGeo = new THREE.PlaneGeometry(ROOM_D, ROOM_H);
  const leftWall = new THREE.Mesh(sideWallGeo, wallMat.clone());
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-ROOM_W / 2, ROOM_H / 2, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  const rightWall = new THREE.Mesh(sideWallGeo, wallMat.clone());
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(ROOM_W / 2, ROOM_H / 2, 0);
  rightWall.receiveShadow = true;
  scene.add(rightWall);

  scene.add(makeBox(ROOM_W, 0.1, 0.05, COL.wallDark, 0, 0.05, -ROOM_D / 2 + 0.025));
  scene.add(makeBox(0.05, 0.1, ROOM_D, COL.wallDark, -ROOM_W / 2 + 0.025, 0.05, 0));
  scene.add(makeBox(0.05, 0.1, ROOM_D, COL.wallDark, ROOM_W / 2 - 0.025, 0.05, 0));

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
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
  tileTex.repeat.set(4, 2);
  const tileFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.8, metalness: 0.1 }),
  );
  tileFloor.rotation.x = -Math.PI / 2;
  tileFloor.position.y = 0.004;
  tileFloor.receiveShadow = true;
  scene.add(tileFloor);

  const restWidth = ROOM_W / 2.2;
  const restDepth = ROOM_D / 2.1;
  const restCarpet = new THREE.Mesh(
    new THREE.PlaneGeometry(restWidth, restDepth),
    new THREE.MeshStandardMaterial({
      map: createCarpetTexture(),
      roughness: 0.9,
      metalness: 0,
      color: COL.carpetDark,
    }),
  );
  restCarpet.rotation.x = -Math.PI / 2;
  restCarpet.position.set(-ROOM_W / 2 + restWidth / 2, 0.005, ROOM_D / 2 - restDepth / 2);
  restCarpet.receiveShadow = true;
  scene.add(restCarpet);

  function addFloorLabel(text: string, x: number, z: number, color: string): void {
    const charWidth = 8;
    const charHeight = 10;
    const width = text.length * charWidth + 8;
    const height = charHeight + 6;
    const tex = makeCanvasTexture(width, height, (ctx) => {
      ctx.font = `${charHeight}px ui-monospace, Menlo, monospace`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = color;
      ctx.fillText(text, 4, 3);
    });
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.01, height * 0.01),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    label.rotation.x = -Math.PI / 2;
    label.position.set(x, 0.006, z);
    scene.add(label);
  }

  addFloorLabel('REST', -ROOM_W / 2 + restWidth / 2, ROOM_D / 2 - restDepth / 2, '#16a34a');

  const glassHeight = ROOM_H * 0.65;
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xaaccee,
    transparent: true,
    opacity: 0.2,
    roughness: 0.05,
    metalness: 0.8,
    side: THREE.DoubleSide,
  });

  function addGlassPanel(
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    rotY: number,
  ): void {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
    panel.position.set(x, y, z);
    panel.rotation.y = rotY;
    scene.add(panel);
    const isZAligned = Math.abs(rotY) < 0.1 || Math.abs(rotY - Math.PI) < 0.1;
    if (isZAligned) {
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

  const restRight = -ROOM_W / 2 + restWidth;
  const restFront = ROOM_D / 2 - restDepth;
  addGlassPanel(
    restDepth,
    glassHeight,
    restRight,
    glassHeight / 2,
    restFront + restDepth / 2,
    Math.PI / 2,
  );
  const doorGapWidth = 1.0;
  const frontSegmentWidth = restWidth - doorGapWidth;
  addGlassPanel(
    frontSegmentWidth,
    glassHeight,
    -ROOM_W / 2 + frontSegmentWidth / 2,
    glassHeight / 2,
    restFront,
    0,
  );
  scene.add(
    makeBox(
      0.06,
      glassHeight + 0.04,
      0.06,
      0x8a8a9a,
      restRight,
      glassHeight / 2 + 0.02,
      restFront,
      { roughness: 0.3, metalness: 0.6 },
    ),
  );
  scene.add(
    makeBox(
      doorGapWidth + 0.08,
      0.06,
      0.06,
      0x8a8a9a,
      restRight - doorGapWidth / 2,
      glassHeight + 0.02,
      restFront,
      {
        roughness: 0.3,
        metalness: 0.6,
      },
    ),
  );

  const sofaX = -ROOM_W / 2 + 0.5;
  const sofaZ = ROOM_D / 2 - restDepth / 2;
  const sofaLength = restDepth * 0.7;
  scene.add(makeBox(0.7, 0.3, sofaLength, 0x4a6a5a, sofaX, 0.25, sofaZ, { roughness: 0.8 }));
  scene.add(
    makeBox(0.12, 0.45, sofaLength, 0x4a6a5a, sofaX - 0.35, 0.47, sofaZ, { roughness: 0.8 }),
  );
  scene.add(
    makeBox(0.12, 0.35, 0.7, 0x4a6a5a, sofaX, 0.33, sofaZ - sofaLength / 2 + 0.35, {
      roughness: 0.8,
    }),
  );
  scene.add(
    makeBox(0.12, 0.35, 0.7, 0x4a6a5a, sofaX, 0.33, sofaZ + sofaLength / 2 - 0.35, {
      roughness: 0.8,
    }),
  );
  scene.add(makeBox(0.5, 0.05, 0.8, COL.desk, sofaX + 0.7, 0.4, sofaZ, { roughness: 0.5 }));
  scene.add(makeBox(0.06, 0.38, 0.06, COL.desk, sofaX + 0.52, 0.19, sofaZ - 0.3));
  scene.add(makeBox(0.06, 0.38, 0.06, COL.desk, sofaX + 0.52, 0.19, sofaZ + 0.3));
  scene.add(makeBox(0.06, 0.38, 0.06, COL.desk, sofaX + 0.88, 0.19, sofaZ - 0.3));
  scene.add(makeBox(0.06, 0.38, 0.06, COL.desk, sofaX + 0.88, 0.19, sofaZ + 0.3));

  const tableWidth = 4.0;
  const tableHeight = 0.08;
  const tableDepth = 1.8;
  const tableX = 2.0;
  const tableZ = 2.5;
  scene.add(
    makeBox(tableWidth, tableHeight, tableDepth, 0x6e5a3e, tableX, 0.75, tableZ, {
      roughness: 0.4,
      metalness: 0.15,
    }),
  );
  for (const legX of [-tableWidth / 2 + 0.15, tableWidth / 2 - 0.15]) {
    for (const legZ of [-tableDepth / 2 + 0.12, tableDepth / 2 - 0.12]) {
      scene.add(
        makeBox(0.05, 0.75, 0.05, 0x8a8a9a, tableX + legX, 0.375, tableZ + legZ, {
          roughness: 0.3,
          metalness: 0.6,
        }),
      );
    }
  }
  scene.add(
    makeBox(0.25, 0.08, 0.2, 0x3a3a4a, tableX, 0.82, tableZ, { roughness: 0.3, metalness: 0.5 }),
  );
  const projectorLens = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x88aaff, emissiveIntensity: 1.5 }),
  );
  projectorLens.position.set(tableX + 0.1, 0.86, tableZ);
  scene.add(projectorLens);

  const projectorSpot = new THREE.SpotLight(0xaaccff, 3, 6, Math.PI / 8, 0.5, 1);
  projectorSpot.position.set(tableX + 0.1, 0.88, tableZ);
  projectorSpot.target.position.set(ROOM_W / 2 - 0.05, 1.9, tableZ);
  scene.add(projectorSpot);
  scene.add(projectorSpot.target);

  const beamLength = ROOM_W / 2 - tableX - 0.1;
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, beamLength, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xaaccff,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  beam.position.set(tableX + 0.1 + beamLength / 2, 1.38, tableZ);
  beam.rotation.z = Math.PI / 2;
  scene.add(beam);

  const screenWidth = 2.4;
  const screenHeight = 1.6;
  const projectionTexture = createProjectionScreenTexture(monitorData, 0);
  const projectionMaterial = new THREE.MeshStandardMaterial({
    map: projectionTexture,
    color: 0xf0f0f0,
    emissive: 0x334455,
    emissiveIntensity: 0.3,
    roughness: 0.9,
    metalness: 0,
  });
  const projScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(screenWidth, screenHeight),
    projectionMaterial,
  );
  projScreen.rotation.y = -Math.PI / 2;
  projScreen.position.set(ROOM_W / 2 - 0.03, 1.9, tableZ);
  scene.add(projScreen);
  scene.add(
    makeBox(
      0.04,
      screenHeight + 0.08,
      screenWidth + 0.08,
      0x5a5a6a,
      ROOM_W / 2 - 0.01,
      1.9,
      tableZ,
      { roughness: 0.4, metalness: 0.3 },
    ),
  );

  addChair(scene, tableX - tableWidth / 2 - 0.6, tableZ, FACE.POS_X);
  for (let i = -1.5; i <= 1.5; i += 1) {
    addChair(scene, tableX + i * 1.0, tableZ - 1.2, FACE.POS_Z);
    addChair(scene, tableX + i * 1.0, tableZ + 1.2, FACE.NEG_Z);
  }
  addFloorLabel('DISCUSS', tableX, tableZ - tableDepth / 2 - 0.3, '#f0b429');

  const aisleZ = -2.2;
  const rowOffset = 1.8;
  const workstationXs = [-6.5, -3.9, -1.3, 1.3, 3.9, 6.5];
  for (const workX of workstationXs) {
    addWorkstation(scene, workX, aisleZ - rowOffset, FACE.NEG_Z);
    addWorkstation(scene, workX, aisleZ + rowOffset, FACE.NEG_Z);
  }
  addFloorLabel('WORK', 0, aisleZ + 0.5, '#3aa0ff');

  const monitor = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 1.8),
    new THREE.MeshStandardMaterial({
      map: createMonitorTexture(monitorData),
      emissive: 0x112244,
      emissiveIntensity: 0.4,
      roughness: 0.3,
      metalness: 0.5,
    }),
  );
  monitor.position.set(0, 1.9, -ROOM_D / 2 + 0.02);
  scene.add(monitor);
  scene.add(makeBox(3.74, 1.94, 0.08, COL.monitorFrame, 0, 1.9, -ROOM_D / 2 + 0.01));
  scene.add(makeBox(0.08, 0.5, 0.08, COL.monitorFrame, 0, 0.5, -ROOM_D / 2 + 0.1));
  scene.add(makeBox(0.6, 0.04, 0.3, COL.monitorFrame, 0, 0.25, -ROOM_D / 2 + 0.15));

  function addWindow(x: number, y: number, w: number, h: number): void {
    const windowPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        color: COL.window,
        emissive: 0x3a6080,
        emissiveIntensity: 0.4,
        roughness: 0.1,
        metalness: 0.8,
        transparent: true,
        opacity: 0.7,
      }),
    );
    windowPanel.position.set(x, y, -ROOM_D / 2 + 0.015);
    scene.add(windowPanel);
    scene.add(makeBox(w + 0.08, 0.04, 0.04, COL.windowFrame, x, y + h / 2, -ROOM_D / 2 + 0.02));
    scene.add(makeBox(w + 0.08, 0.04, 0.04, COL.windowFrame, x, y - h / 2, -ROOM_D / 2 + 0.02));
    scene.add(makeBox(0.04, h + 0.08, 0.04, COL.windowFrame, x - w / 2, y, -ROOM_D / 2 + 0.02));
    scene.add(makeBox(0.04, h + 0.08, 0.04, COL.windowFrame, x + w / 2, y, -ROOM_D / 2 + 0.02));
    scene.add(makeBox(w, 0.03, 0.02, COL.windowFrame, x, y, -ROOM_D / 2 + 0.025));
    scene.add(makeBox(0.03, h, 0.02, COL.windowFrame, x, y, -ROOM_D / 2 + 0.025));
  }
  addWindow(-5.5, 2.0, 1.2, 0.8);
  addWindow(5.5, 2.0, 1.2, 0.8);

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.4),
    new THREE.MeshStandardMaterial({
      color: COL.sign,
      emissive: 0x806020,
      emissiveIntensity: 0.15,
      roughness: 0.6,
    }),
  );
  sign.position.set(3.5, 2.2, -ROOM_D / 2 + 0.015);
  scene.add(sign);
  scene.add(makeBox(0.64, 0.44, 0.03, COL.signBorder, 3.5, 2.2, -ROOM_D / 2 + 0.005));

  function addPlant(x: number, z: number, scale = 1): void {
    scene.add(makeBox(0.2 * scale, 0.25 * scale, 0.2 * scale, COL.plantPot, x, 0.125 * scale, z));
    const foliage = new THREE.Mesh(
      new THREE.SphereGeometry(0.25 * scale, 8, 6),
      new THREE.MeshStandardMaterial({ color: COL.plant, roughness: 0.9 }),
    );
    foliage.position.set(x, 0.45 * scale, z);
    foliage.castShadow = true;
    scene.add(foliage);
  }
  addPlant(-7.2, -2.0);
  addPlant(7.2, -2.0);
  addPlant(-7.2, 3.8, 0.8);
  addPlant(7.2, 3.8, 1.3);

  const shelfX = -ROOM_W / 2 + 0.2;
  const shelfZ = restFront + 0.5;
  scene.add(
    makeBox(0.3, 1.2, 0.8, COL.shelf, shelfX, 0.6, shelfZ, { roughness: 0.5, metalness: 0.3 }),
  );
  for (const shelfY of [0.3, 0.6, 0.9]) {
    scene.add(makeBox(0.32, 0.03, 0.82, COL.shelfBook, shelfX, shelfY, shelfZ));
  }
  const bookColors = [0xa4c4d8, 0xd8a4a4, 0xa4d8a4, 0xd8d8a4, 0xc4a4d8];
  for (let i = 0; i < 5; i += 1) {
    scene.add(
      makeBox(0.08, 0.2, 0.15, bookColors[i]!, shelfX, 0.42 + i * 0.04, shelfZ - 0.25 + i * 0.12),
    );
  }

  scene.add(makeBox(0.15, 0.4, 0.1, COL.desk, 6.5, 0.2, 3.8));
  const redLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 6, 4),
    new THREE.MeshStandardMaterial({
      color: COL.danger,
      emissive: COL.danger,
      emissiveIntensity: 2,
    }),
  );
  redLight.position.set(6.5, 0.12, 3.85);
  scene.add(redLight);
  const blueLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 6, 4),
    new THREE.MeshStandardMaterial({
      color: COL.accent,
      emissive: COL.accent,
      emissiveIntensity: 2,
    }),
  );
  blueLight.position.set(6.5, 0.25, 3.85);
  scene.add(blueLight);

  function addCoffeeCup(x: number, y: number, z: number): void {
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.025, 0.06, 8),
      new THREE.MeshStandardMaterial({ color: COL.coffee, roughness: 0.5 }),
    );
    cup.position.set(x, y, z);
    cup.castShadow = true;
    scene.add(cup);
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.02, 0.005, 6, 8, Math.PI),
      new THREE.MeshStandardMaterial({ color: COL.coffeeHandle, roughness: 0.5 }),
    );
    handle.position.set(x + 0.035, y, z);
    handle.rotation.y = Math.PI / 2;
    scene.add(handle);
  }
  addCoffeeCup(-4.5, 0.42, 3.2);
  addCoffeeCup(6.5, 0.78, -3.0);
  addCoffeeCup(4.0, 0.81, 2.0);
  addCoffeeCup(3.0, 0.78, -ROOM_D / 2 + 0.6);

  return { monitorMesh: monitor, projScreen };
}
