import type { GraphNode } from '../../data/build-knowledge-graph.js';
import { seededUnit } from './workspace-knowledge-graph-canvas-helpers.js';

export type NodeGlyphKind =
  | 'workspace'
  | 'category'
  | 'architecture'
  | 'constitution'
  | 'memory'
  | 'knowledge'
  | 'artifact';

export interface NodeVisualStyle {
  baseColor: string;
  glowColor: string;
  haloColor: string;
  ringColor: string;
  secondaryColor: string;
  sweepColor: string;
}

export function nodeGlyphKind(kind: GraphNode['kind']): NodeGlyphKind {
  switch (kind) {
    case 'workspace':
      return 'workspace';
    case 'category':
      return 'category';
    case 'architecture':
      return 'architecture';
    case 'constitution':
      return 'constitution';
    case 'memory':
      return 'memory';
    case 'knowledge':
      return 'knowledge';
    case 'artifact':
      return 'artifact';
  }
}

export function nodeGlyphSweepAngle(
  kind: GraphNode['kind'],
  tick: number,
  selected: boolean,
): number {
  const base = selected ? tick * 0.022 : tick * 0.014;
  switch (kind) {
    case 'workspace':
      return base;
    case 'architecture':
      return base + Math.PI * 0.1;
    case 'constitution':
      return base + Math.PI * 0.26;
    case 'memory':
      return base + Math.PI * 0.42;
    case 'artifact':
      return base + Math.PI * 0.58;
    case 'knowledge':
      return base + Math.PI * 0.18;
    case 'category':
      return base + Math.PI * 0.08;
  }
}

export function nodeMotionProfile(
  kind: GraphNode['kind'],
  focusWeight: number,
): {
  glowScale: number;
  haloScale: number;
  profileAmplitude: number;
  scanAmplitude: number;
  scanBase: number;
  sweepAmplitude: number;
  sweepBase: number;
} {
  switch (kind) {
    case 'workspace':
      return {
        glowScale: 1.06,
        haloScale: 1.1,
        profileAmplitude: 0.52,
        scanAmplitude: 0.16,
        scanBase: 0.08,
        sweepAmplitude: 0.48,
        sweepBase: 0.05 + focusWeight * 0.04,
      };
    case 'architecture':
      return {
        glowScale: 0.9,
        haloScale: 0.94,
        profileAmplitude: 0.14,
        scanAmplitude: 0.28,
        scanBase: 0.04,
        sweepAmplitude: 0.3,
        sweepBase: 0.03,
      };
    case 'constitution':
      return {
        glowScale: 0.96,
        haloScale: 1,
        profileAmplitude: 0.2,
        scanAmplitude: 0.36,
        scanBase: 0.05,
        sweepAmplitude: 0.34,
        sweepBase: 0.04,
      };
    case 'memory':
      return {
        glowScale: 1.18,
        haloScale: 1.14,
        profileAmplitude: 0.48,
        scanAmplitude: 0.44,
        scanBase: 0.02,
        sweepAmplitude: 0.74,
        sweepBase: 0.08 + focusWeight * 0.04,
      };
    case 'artifact':
      return {
        glowScale: 1.12,
        haloScale: 1.08,
        profileAmplitude: 0.58,
        scanAmplitude: 0.56,
        scanBase: 0.06,
        sweepAmplitude: 1.02,
        sweepBase: 0.12,
      };
    case 'knowledge':
      return {
        glowScale: 1,
        haloScale: 1.02,
        profileAmplitude: 0.3,
        scanAmplitude: 0.34,
        scanBase: 0.04,
        sweepAmplitude: 0.52,
        sweepBase: 0.08,
      };
    case 'category':
      return {
        glowScale: 0.94,
        haloScale: 0.98,
        profileAmplitude: 0.12,
        scanAmplitude: 0.12,
        scanBase: 0.03,
        sweepAmplitude: 0.28,
        sweepBase: 0.04,
      };
  }
}

export function nodeOrbitSpeed(
  kind: GraphNode['kind'],
  focusWeight: number,
  selected: boolean,
): number {
  if (selected) {
    return 0.055;
  }
  switch (kind) {
    case 'architecture':
      return 0.02 + focusWeight * 0.008;
    case 'constitution':
      return 0.026 + focusWeight * 0.01;
    case 'memory':
      return 0.042 + focusWeight * 0.018;
    case 'artifact':
      return 0.05 + focusWeight * 0.02;
    case 'workspace':
      return 0.034 + focusWeight * 0.012;
    case 'knowledge':
      return 0.03 + focusWeight * 0.012;
    case 'category':
      return 0.018 + focusWeight * 0.006;
  }
}

export function nodeOrbitSpread(
  kind: GraphNode['kind'],
  focusWeight: number,
  selected: boolean,
): number {
  if (selected) {
    return 0.42;
  }
  switch (kind) {
    case 'architecture':
      return 0.14 + focusWeight * 0.06;
    case 'constitution':
      return 0.2 + focusWeight * 0.06;
    case 'memory':
      return 0.44 + focusWeight * 0.12;
    case 'artifact':
      return 0.58 + focusWeight * 0.16;
    case 'workspace':
      return 0.26 + focusWeight * 0.08;
    case 'knowledge':
      return 0.32 + focusWeight * 0.1;
    case 'category':
      return 0.12 + focusWeight * 0.05;
  }
}

export function nodeOrbitTrailDensity(
  kind: GraphNode['kind'],
  focusWeight: number,
  selected: boolean,
): number {
  if (selected) {
    return 0.08;
  }
  switch (kind) {
    case 'architecture':
      return 0.02 + focusWeight * 0.02;
    case 'constitution':
      return 0.032 + focusWeight * 0.022;
    case 'memory':
      return 0.08 + focusWeight * 0.04;
    case 'artifact':
      return 0.09 + focusWeight * 0.05;
    case 'workspace':
      return 0.038 + focusWeight * 0.025;
    case 'knowledge':
      return 0.05 + focusWeight * 0.03;
    case 'category':
      return 0.018 + focusWeight * 0.016;
  }
}

export function nodeOrbitLift(
  kind: GraphNode['kind'],
  focusWeight: number,
  selected: boolean,
): number {
  if (selected) {
    return 0.9;
  }
  switch (kind) {
    case 'memory':
      return 1.4 + focusWeight * 0.8;
    case 'artifact':
      return 1 + focusWeight * 0.6;
    case 'constitution':
      return 0.42 + focusWeight * 0.22;
    case 'architecture':
      return 0.18 + focusWeight * 0.1;
    case 'workspace':
      return 0.6 + focusWeight * 0.3;
    case 'knowledge':
      return 0.5 + focusWeight * 0.24;
    case 'category':
      return 0.14 + focusWeight * 0.06;
  }
}

export function drawNodeOrbitParticles({
  context,
  focusDistance,
  focused,
  focusWeight,
  nodeId,
  nodeKind,
  primaryColor,
  scaledRadius,
  secondaryColor,
  selected,
  tick,
  x,
  y,
  zoom,
}: {
  context: CanvasRenderingContext2D;
  focusDistance: number | null;
  focused: boolean;
  focusWeight: number;
  nodeId: string;
  nodeKind: GraphNode['kind'];
  primaryColor: string;
  scaledRadius: number;
  secondaryColor: string;
  selected: boolean;
  tick: number;
  x: number;
  y: number;
  zoom: number;
}) {
  const trailDensity = nodeOrbitTrailDensity(nodeKind, focusWeight, selected);
  const particleCount = selected ? 4 : focused ? 3 : Math.max(1, Math.round(trailDensity * 24));
  const animatedTick = focusWaveTick(tick, focusDistance, 6);
  const speed = nodeOrbitSpeed(nodeKind, focusWeight, selected);
  const spread = nodeOrbitSpread(nodeKind, focusWeight, selected);
  const lift = nodeOrbitLift(nodeKind, focusWeight, selected);
  const orbitRadius =
    scaledRadius + scaledRadius * spread + (selected ? 7 : focused ? 5 : 3) / zoom;
  const yLift = 0.72 + lift * 0.08;
  const particleRadius = Math.max(0.8 / zoom, scaledRadius * (selected ? 0.055 : 0.038));
  const orbitAlpha = selected
    ? 0.22 + trailDensity * 1.7
    : focused
      ? 0.12 + focusWeight * 0.16 + trailDensity
      : 0.04 + trailDensity * 0.42;

  context.save();
  for (let index = 0; index < particleCount; index += 1) {
    const seed = seededUnit(`${nodeId}:orbit:${index}`);
    const angle = animatedTick * speed + seed * Math.PI * 2 + (index * Math.PI * 2) / particleCount;
    const particleX = x + Math.cos(angle) * orbitRadius;
    const particleY = y + Math.sin(angle) * orbitRadius * yLift;

    context.globalAlpha = Math.max(0.02, orbitAlpha * (1 - index * 0.12));
    context.fillStyle = index === 0 ? primaryColor : secondaryColor;
    context.beginPath();
    context.arc(particleX, particleY, particleRadius, 0, Math.PI * 2);
    context.fill();

    if (selected || focused) {
      context.globalAlpha = Math.max(0.03, orbitAlpha * 0.38);
      context.strokeStyle = primaryColor;
      context.lineWidth = Math.max(0.32 / zoom, scaledRadius * 0.012);
      context.beginPath();
      context.arc(x, y, orbitRadius, angle - 0.22, angle + 0.04);
      context.stroke();
    }
  }
  context.restore();
}

export function pulse(tick: number, seed: string, amplitude: number, base: number): number {
  const phase = seededUnit(seed) * Math.PI * 2;
  return base + amplitude * (0.5 + Math.sin(tick * 0.045 + phase) * 0.5);
}

export function focusWaveTick(
  tick: number,
  focusDistance: number | null,
  lagPerHop: number,
): number {
  if (focusDistance === null || focusDistance <= 0) {
    return tick;
  }
  return tick - focusDistance * lagPerHop;
}

export function safeClosePath(context: CanvasRenderingContext2D): void {
  if (typeof context.closePath === 'function') {
    context.closePath();
  }
}

export function traceRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + width, y);
  context.lineTo(x + width, y + height);
  context.lineTo(x, y + height);
  safeClosePath(context);
}

export function drawNodeGlyph({
  accent,
  context,
  dimmed,
  focusWeight,
  nodeKind,
  scaledRadius,
  secondaryColor,
  selected,
  sweepColor,
  tick,
  x,
  y,
  zoom,
}: {
  accent: string;
  context: CanvasRenderingContext2D;
  dimmed: boolean;
  focusWeight: number;
  nodeKind: GraphNode['kind'];
  scaledRadius: number;
  secondaryColor: string;
  selected: boolean;
  sweepColor: string;
  tick: number;
  x: number;
  y: number;
  zoom: number;
}) {
  const glyphKind = nodeGlyphKind(nodeKind);
  const radius = Math.max(3.2, scaledRadius * 0.52);
  const alpha = dimmed ? 0.3 : selected ? 0.9 + pulse(tick, `${nodeKind}:glyph`, 0.1, 0) : 0.85;
  const sweepAngle = nodeGlyphSweepAngle(nodeKind, tick, selected);
  const detailPulse = pulse(tick, `${nodeKind}:glyph-detail`, 0.18, 0.76);

  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = accent;
  context.fillStyle = accent;
  context.lineWidth = Math.max(1.2 / zoom, scaledRadius * 0.075);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  switch (glyphKind) {
    case 'workspace': {
      context.beginPath();
      context.moveTo(x - radius * 0.78, y - radius * 0.12);
      context.lineTo(x, y - radius * 0.74);
      context.lineTo(x + radius * 0.78, y - radius * 0.12);
      context.lineTo(x + radius * 0.52, y + radius * 0.7);
      context.lineTo(x - radius * 0.52, y + radius * 0.7);
      safeClosePath(context);
      context.stroke();
      break;
    }
    case 'category': {
      context.beginPath();
      context.arc(x, y, radius * 0.82, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.arc(x, y, radius * 0.28, 0, Math.PI * 2);
      context.fill();
      break;
    }
    case 'architecture': {
      traceRectPath(context, x - radius * 0.7, y - radius * 0.58, radius * 0.58, radius * 0.58);
      traceRectPath(context, x + radius * 0.12, y - radius * 0.58, radius * 0.58, radius * 0.58);
      traceRectPath(context, x - radius * 0.3, y + radius * 0.12, radius * 0.58, radius * 0.58);
      context.globalAlpha = alpha * 0.7;
      context.strokeStyle = secondaryColor;
      context.lineWidth = Math.max(0.6 / zoom, scaledRadius * 0.03);
      context.beginPath();
      context.arc(x, y, radius * 0.92, sweepAngle, sweepAngle + Math.PI * 0.34);
      context.stroke();
      context.globalAlpha = alpha * (0.22 + detailPulse * 0.18);
      context.beginPath();
      context.moveTo(x - radius * 0.58, y - radius * 0.18);
      context.lineTo(x + radius * 0.52, y - radius * 0.18);
      context.moveTo(x - radius * 0.44, y + radius * 0.24);
      context.lineTo(x + radius * 0.64, y + radius * 0.24);
      context.stroke();
      break;
    }
    case 'constitution': {
      context.beginPath();
      context.moveTo(x - radius * 0.48, y - radius * 0.66);
      context.lineTo(x + radius * 0.36, y - radius * 0.66);
      context.lineTo(x + radius * 0.62, y - radius * 0.38);
      context.lineTo(x + radius * 0.62, y + radius * 0.66);
      context.lineTo(x - radius * 0.48, y + radius * 0.66);
      safeClosePath(context);
      context.stroke();
      context.beginPath();
      context.moveTo(x - radius * 0.18, y - radius * 0.22);
      context.lineTo(x + radius * 0.18, y - radius * 0.22);
      context.moveTo(x - radius * 0.18, y + radius * 0.06);
      context.lineTo(x + radius * 0.18, y + radius * 0.06);
      context.stroke();
      context.globalAlpha = alpha * 0.55;
      context.strokeStyle = secondaryColor;
      context.lineWidth = Math.max(0.5 / zoom, scaledRadius * 0.025);
      context.beginPath();
      context.arc(x, y, radius * 0.88, sweepAngle + Math.PI * 0.4, sweepAngle + Math.PI * 0.82);
      context.stroke();
      context.globalAlpha = alpha * (0.18 + detailPulse * 0.16);
      context.beginPath();
      context.moveTo(x - radius * 0.22, y + radius * 0.28);
      context.lineTo(x + radius * 0.22, y + radius * 0.28);
      context.stroke();
      break;
    }
    case 'memory': {
      context.beginPath();
      context.arc(x - radius * 0.22, y, radius * 0.38, Math.PI * 0.5, Math.PI * 1.5);
      context.arc(x + radius * 0.22, y, radius * 0.38, Math.PI * 1.5, Math.PI * 0.5);
      context.closePath();
      context.stroke();
      context.globalAlpha = alpha * 0.5;
      context.strokeStyle = secondaryColor;
      context.lineWidth = Math.max(0.5 / zoom, scaledRadius * 0.025);
      context.beginPath();
      context.arc(x, y, radius * 0.78, sweepAngle, sweepAngle + Math.PI * 0.52);
      context.stroke();
      context.globalAlpha = alpha * (0.14 + detailPulse * 0.16);
      context.beginPath();
      context.arc(x, y - radius * 0.12, radius * 0.22, 0, Math.PI * 2);
      context.stroke();
      break;
    }
    case 'knowledge': {
      context.beginPath();
      context.moveTo(x, y - radius * 0.72);
      context.lineTo(x + radius * 0.66, y);
      context.lineTo(x, y + radius * 0.72);
      context.lineTo(x - radius * 0.66, y);
      safeClosePath(context);
      context.stroke();
      context.globalAlpha = alpha * 0.6;
      context.strokeStyle = secondaryColor;
      context.lineWidth = Math.max(0.55 / zoom, scaledRadius * 0.028);
      context.beginPath();
      context.arc(x, y, radius * 0.96, sweepAngle + Math.PI * 0.15, sweepAngle + Math.PI * 0.5);
      context.stroke();
      context.globalAlpha = alpha * (0.2 + detailPulse * 0.14);
      context.beginPath();
      context.moveTo(x - radius * 0.18, y);
      context.lineTo(x + radius * 0.18, y);
      context.moveTo(x, y - radius * 0.18);
      context.lineTo(x, y + radius * 0.18);
      context.stroke();
      break;
    }
    case 'artifact': {
      context.beginPath();
      context.moveTo(x - radius * 0.52, y - radius * 0.72);
      context.lineTo(x + radius * 0.18, y - radius * 0.72);
      context.lineTo(x + radius * 0.52, y - radius * 0.36);
      context.lineTo(x + radius * 0.52, y + radius * 0.72);
      context.lineTo(x - radius * 0.52, y + radius * 0.72);
      safeClosePath(context);
      context.stroke();
      context.beginPath();
      context.moveTo(x + radius * 0.16, y - radius * 0.72);
      context.lineTo(x + radius * 0.16, y - radius * 0.28);
      context.lineTo(x + radius * 0.52, y - radius * 0.28);
      context.stroke();
      context.globalAlpha = alpha * 0.55;
      context.strokeStyle = sweepColor;
      context.lineWidth = Math.max(0.5 / zoom, scaledRadius * 0.022);
      context.beginPath();
      context.arc(x, y, radius * 0.98, sweepAngle, sweepAngle + Math.PI * 0.58);
      context.stroke();
      context.globalAlpha = alpha * (0.22 + detailPulse * 0.18);
      context.beginPath();
      context.moveTo(x - radius * 0.18, y + radius * 0.18);
      context.lineTo(x + radius * 0.18, y + radius * 0.18);
      context.stroke();
      break;
    }
  }

  context.restore();
}

export function createSafeLinearGradient(
  context: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  startColor: string,
  endColor: string,
  stops?: Array<[number, string]>,
): CanvasGradient | string {
  if (typeof context.createLinearGradient !== 'function') {
    return endColor;
  }
  const gradient = context.createLinearGradient(x0, y0, x1, y1);
  if (stops) {
    for (const [offset, color] of stops) {
      gradient.addColorStop(offset, color);
    }
  } else {
    gradient.addColorStop(0, startColor);
    gradient.addColorStop(1, endColor);
  }
  return gradient;
}

export function createSafeRadialGradient(
  context: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  r0: number,
  x1: number,
  y1: number,
  r1: number,
  stops: Array<[number, string]>,
  fallback: string,
): CanvasGradient | string {
  if (typeof context.createRadialGradient !== 'function') {
    return fallback;
  }
  const gradient = context.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const [offset, color] of stops) {
    gradient.addColorStop(offset, color);
  }
  return gradient;
}

function mixWithOverlay(color: string, overlay: string): CanvasGradient | string {
  if (color.startsWith('#') || color.startsWith('rgb')) {
    return color;
  }
  return overlay;
}

export function drawGraphNode({
  accentColor,
  bgOverlay,
  context,
  dimmed,
  fgStrong,
  focusDistance,
  focusWeight,
  focused,
  nodeId,
  nodeKind,
  nodeRadius,
  renderScale,
  selected,
  style,
  tick,
  x,
  y,
  zoom,
}: {
  accentColor: string;
  bgOverlay: string;
  context: CanvasRenderingContext2D;
  dimmed: boolean;
  fgStrong: string;
  focusDistance: number | null;
  focusWeight: number;
  focused: boolean;
  nodeId: string;
  nodeKind: GraphNode['kind'];
  nodeRadius: number;
  renderScale: number;
  selected: boolean;
  style: NodeVisualStyle;
  tick: number;
  x: number;
  y: number;
  zoom: number;
}) {
  const animatedTick = focusWaveTick(tick, focusDistance, 7);
  const motionProfile = nodeMotionProfile(nodeKind, focusWeight);
  const scanPulse = pulse(
    animatedTick,
    `${nodeId}:scan`,
    motionProfile.scanAmplitude,
    motionProfile.scanBase,
  );
  const profilePulse = pulse(animatedTick, `${nodeId}:profile`, motionProfile.profileAmplitude, 0);
  const glowPulse = pulse(animatedTick, `${nodeId}:glow`, 0.14, 0.92 + focusWeight * 0.06);
  const ringPulse = pulse(animatedTick, `${nodeId}:ring`, 0.1, 0.94 + focusWeight * 0.04);
  const sweepPulse = pulse(
    animatedTick,
    `${nodeId}:sweep`,
    motionProfile.sweepAmplitude,
    motionProfile.sweepBase,
  );
  const scaledRadius = nodeRadius * renderScale;
  const haloRadius =
    scaledRadius +
    (selected ? 10 : focused ? 8 : 5) * glowPulse * (motionProfile.haloScale + profilePulse * 0.06);
  const glowRadius =
    scaledRadius +
    (selected ? 16 : focused ? 12 : 8) *
      glowPulse *
      (motionProfile.glowScale + profilePulse * 0.08);
  const coreRadius = Math.max(3.8, scaledRadius * 0.26);
  const bodyFill = nodeKind === 'workspace' ? mixWithOverlay(accentColor, bgOverlay) : bgOverlay;

  context.save();

  const glow = createSafeRadialGradient(
    context,
    x,
    y,
    coreRadius,
    x,
    y,
    glowRadius,
    [
      [0, style.glowColor],
      [1, 'transparent'],
    ],
    style.glowColor,
  );
  context.globalAlpha = dimmed
    ? 0.08
    : selected
      ? 0.3 + ringPulse * 0.08
      : focused
        ? 0.16 + focusWeight * 0.08 + ringPulse * 0.04 + profilePulse * 0.06 + scanPulse * 0.03
        : 0.14;
  context.fillStyle = glow;
  context.beginPath();
  context.arc(x, y, glowRadius, 0, Math.PI * 2);
  context.fill();

  const outerRing = createSafeRadialGradient(
    context,
    x,
    y,
    scaledRadius * 0.52,
    x,
    y,
    haloRadius,
    [
      [0, 'transparent'],
      [1, style.haloColor],
    ],
    style.haloColor,
  );
  context.globalAlpha = dimmed
    ? 0.1
    : selected
      ? 0.22 + glowPulse * 0.08
      : focused
        ? 0.1 + focusWeight * 0.08 + glowPulse * 0.04 + profilePulse * 0.04 + scanPulse * 0.02
        : 0.1;
  context.fillStyle = outerRing;
  context.beginPath();
  context.arc(x, y, haloRadius, 0, Math.PI * 2);
  context.fill();

  context.globalAlpha = dimmed ? 0.2 : selected ? 0.98 : focused ? 0.78 + focusWeight * 0.16 : 0.82;
  context.fillStyle = bodyFill;
  context.strokeStyle = selected ? accentColor : style.ringColor;
  context.lineWidth =
    (selected ? 2.32 + ringPulse * 0.24 : focused ? 1.14 + ringPulse * 0.08 : 0.9) / zoom;
  context.beginPath();
  context.arc(x, y, scaledRadius, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  const surface = createSafeRadialGradient(
    context,
    x - scaledRadius * 0.36,
    y - scaledRadius * 0.42,
    0,
    x - scaledRadius * 0.2,
    y - scaledRadius * 0.18,
    scaledRadius * 1.12,
    [
      [0, fgStrong],
      [0.22, typeof bodyFill === 'string' ? bodyFill : style.baseColor],
      [1, style.baseColor],
    ],
    typeof bodyFill === 'string' ? bodyFill : style.baseColor,
  );
  context.globalAlpha = dimmed
    ? 0.18
    : selected
      ? 0.36 + glowPulse * 0.1
      : focused
        ? 0.2 + focusWeight * 0.16 + profilePulse * 0.06 + scanPulse * 0.04
        : 0.24;
  context.fillStyle = surface;
  context.beginPath();
  context.arc(x, y, scaledRadius - 1 / zoom, 0, Math.PI * 2);
  context.fill();

  const innerRing = createSafeLinearGradient(
    context,
    x - scaledRadius,
    y - scaledRadius,
    x + scaledRadius,
    y + scaledRadius,
    fgStrong,
    typeof bodyFill === 'string' ? bodyFill : style.baseColor,
    [
      [0, fgStrong],
      [0.42, style.baseColor],
      [1, typeof bodyFill === 'string' ? bodyFill : style.baseColor],
    ],
  );
  context.globalAlpha = dimmed
    ? 0.18
    : selected
      ? 0.68 + ringPulse * 0.1
      : focused
        ? 0.38 + focusWeight * 0.22 + profilePulse * 0.08 + scanPulse * 0.05
        : 0.46;
  context.strokeStyle = innerRing;
  context.lineWidth = Math.max(0.9 / zoom, scaledRadius * 0.08);
  context.beginPath();
  context.arc(x, y, Math.max(2, scaledRadius - 1.6 / zoom), 0, Math.PI * 2);
  context.stroke();

  context.globalAlpha = dimmed
    ? 0.08
    : selected
      ? 0.64
      : focused
        ? 0.22 + focusWeight * 0.24 + profilePulse * 0.08 + scanPulse * 0.04
        : 0.28;
  context.strokeStyle = style.secondaryColor;
  context.lineWidth = Math.max(0.7 / zoom, scaledRadius * 0.045);
  context.beginPath();
  context.arc(
    x,
    y,
    Math.max(2, scaledRadius - 0.8 / zoom),
    Math.PI * (1.2 + sweepPulse),
    Math.PI * (1.75 + sweepPulse),
  );
  context.stroke();

  context.globalAlpha = dimmed
    ? 0.06
    : selected
      ? 0.34
      : focused
        ? 0.12 + focusWeight * 0.18 + profilePulse * 0.06 + scanPulse * 0.04
        : 0.16;
  context.strokeStyle = style.sweepColor;
  context.lineWidth = Math.max(0.6 / zoom, scaledRadius * 0.035);
  context.beginPath();
  context.arc(
    x,
    y,
    Math.max(2, scaledRadius + 1.2 / zoom),
    Math.PI * (0.1 + sweepPulse),
    Math.PI * (0.28 + sweepPulse),
  );
  context.stroke();

  context.globalAlpha = dimmed
    ? 0.2
    : selected
      ? 0.9 + glowPulse * 0.08
      : focused
        ? 0.76 + focusWeight * 0.24
        : 1;
  context.fillStyle = style.baseColor;
  context.beginPath();
  context.arc(x, y, coreRadius, 0, Math.PI * 2);
  context.fill();

  drawNodeGlyph({
    accent: style.baseColor,
    context,
    dimmed,
    focusWeight,
    nodeKind,
    selected,
    scaledRadius,
    secondaryColor: style.secondaryColor,
    sweepColor: style.sweepColor,
    tick: animatedTick,
    x,
    y,
    zoom,
  });

  drawNodeOrbitParticles({
    context,
    focusDistance,
    focusWeight,
    focused,
    nodeId,
    nodeKind,
    primaryColor: style.sweepColor,
    scaledRadius,
    secondaryColor: fgStrong,
    selected,
    tick: animatedTick,
    x,
    y,
    zoom,
  });

  context.globalAlpha = dimmed
    ? 0.12
    : selected
      ? 0.76 + glowPulse * 0.12
      : focused
        ? 0.42 + focusWeight * 0.3
        : 0.52;
  context.fillStyle = fgStrong;
  context.beginPath();
  context.arc(
    x - nodeRadius * 0.3,
    y - scaledRadius * 0.34,
    Math.max(1.4, scaledRadius * 0.14),
    0,
    Math.PI * 2,
  );
  context.fill();

  if (selected) {
    const selectedPulse = pulse(animatedTick, `${nodeId}:selected`, 0.18, 0.72);
    context.globalAlpha = selectedPulse;
    context.strokeStyle = accentColor;
    context.lineWidth = (1.02 + selectedPulse * 0.2) / zoom;
    context.setLineDash([5 / zoom, 4 / zoom]);
    context.beginPath();
    context.arc(x, y, scaledRadius + (5.5 + selectedPulse * 1.2) / zoom, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
  }

  if (selected || focused) {
    context.globalAlpha = selected ? 0.28 : 0.14;
    context.strokeStyle = style.sweepColor;
    context.lineWidth = Math.max(0.55 / zoom, scaledRadius * 0.03);
    context.setLineDash([2.8 / zoom, 7.2 / zoom]);
    context.lineDashOffset = (-tick * (selected ? 0.35 : 0.18)) / zoom;
    context.beginPath();
    context.arc(x, y, scaledRadius + (selected ? 11 : 8) / zoom, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    context.lineDashOffset = 0;
  }

  if (focused) {
    const wavePulse = pulse(animatedTick, `${nodeId}:wave`, 0.18, 0.76);
    context.globalAlpha = selected ? 0.18 + focusWeight * 0.08 : 0.06 + focusWeight * 0.14;
    context.strokeStyle = style.secondaryColor;
    context.lineWidth = Math.max(0.45 / zoom, scaledRadius * 0.022);
    context.beginPath();
    context.arc(
      x,
      y,
      scaledRadius + ((selected ? 15 : 11) + wavePulse * 2.4) / zoom,
      0,
      Math.PI * 2,
    );
    context.stroke();
  }

  context.restore();
}

export function drawDerivesArrowHead({
  accentColor,
  context,
  sourceX,
  sourceY,
  targetRadius,
  targetX,
  targetY,
  zoom,
}: {
  accentColor: string;
  context: CanvasRenderingContext2D;
  sourceX: number;
  sourceY: number;
  targetRadius: number;
  targetX: number;
  targetY: number;
  zoom: number;
}) {
  const angle = Math.atan2(targetY - sourceY, targetX - sourceX);
  if (!Number.isFinite(angle)) {
    return;
  }
  const targetOffset = targetRadius + 5 / zoom;
  const tipX = targetX - Math.cos(angle) * targetOffset;
  const tipY = targetY - Math.sin(angle) * targetOffset;
  const arrowSize = 7 / zoom;
  const wing = Math.PI / 6;

  context.fillStyle = accentColor;
  context.beginPath();
  context.moveTo(tipX, tipY);
  context.lineTo(
    tipX - Math.cos(angle - wing) * arrowSize,
    tipY - Math.sin(angle - wing) * arrowSize,
  );
  context.lineTo(
    tipX - Math.cos(angle + wing) * arrowSize,
    tipY - Math.sin(angle + wing) * arrowSize,
  );
  context.fill();
}

export function drawDerivesLinkFlowPulse({
  accentColor,
  context,
  distance,
  edgeId,
  fgStrong,
  highlighted,
  intensity,
  sourceX,
  sourceY,
  targetX,
  targetY,
  tick,
  zoom,
}: {
  accentColor: string;
  context: CanvasRenderingContext2D;
  distance: number | null;
  edgeId: string;
  fgStrong: string;
  highlighted: boolean;
  intensity: number;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  tick: number;
  zoom: number;
}) {
  const animatedTick = focusWaveTick(tick, distance, 8);
  const progress = (0.12 + pulse(animatedTick, `${edgeId}:flow`, 0.82, 0)) % 1;
  const pulseX = sourceX + (targetX - sourceX) * progress;
  const pulseY = sourceY + (targetY - sourceY) * progress;
  const glow = createSafeRadialGradient(
    context,
    pulseX,
    pulseY,
    0,
    pulseX,
    pulseY,
    9 / zoom,
    [
      [0, fgStrong],
      [0.45, accentColor],
      [1, 'transparent'],
    ],
    accentColor,
  );

  context.save();
  context.globalAlpha = highlighted ? 0.28 + intensity * 0.34 : 0.28;
  context.fillStyle = glow;
  context.beginPath();
  context.arc(pulseX, pulseY, 9 / zoom, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/** 测量文本宽度（使用当前 context.font） */
function measureTextWidth(
  context: CanvasRenderingContext2D,
  text: string,
): number {
  return context.measureText(text).width;
}

/**
 * 绘制带半透明背景的标签文字，避免与连线/节点视觉混淆。
 *
 * - 自动在文字下方绘制圆角矩形背景
 * - 背景尺寸紧贴文字，加内边距
 * - 支持主标题和副标题两行模式
 */
export function drawNodeLabelWithBackground({
  context,
  text,
  x,
  y,
  bgColor,
  textColor,
  fontSizePx,
  zoom,
  textAlign = 'left',
  paddingBottom = 0,
}: {
  context: CanvasRenderingContext2D;
  text: string;
  x: number;
  y: number;
  bgColor: string;
  textColor: string;
  fontSizePx: number;
  zoom: number;
  textAlign?: CanvasTextAlign;
  paddingBottom?: number
}): void {
  const font = `${fontSizePx / zoom}px system-ui, sans-serif`;
  context.font = font;
  const textWidth = measureTextWidth(context, text);
  const textHeight = fontSizePx / zoom;
  const padX = Math.max(3 / zoom, 4);
  const padY = Math.max(1.5 / zoom, 2);
  const radius = Math.max(1.5 / zoom, 2.5);

  let bgX: number;
  if (textAlign === 'center') {
    bgX = x - textWidth / 2 - padX;
  } else if (textAlign === 'right') {
    bgX = x - textWidth - padX;
  } else {
    bgX = x - padX;
  }
  const bgY = y - textHeight * 0.45 - padY;
  const bgW = textWidth + padX * 2;
  const bgH = textHeight * 0.82 + padY * 2 + paddingBottom;

  context.globalAlpha = 0.78;
  context.fillStyle = bgColor;
  context.beginPath();
  context.roundRect(bgX, bgY, bgW, bgH, radius);
  context.fill();

  context.globalAlpha = 1;
  context.fillStyle = textColor;
  context.textAlign = textAlign;
  context.textBaseline = 'middle';
  context.fillText(text, x, y);
}

export function drawContainsLinkPulse({
  context,
  distance,
  edgeId,
  fgStrong,
  highlighted,
  intensity,
  sourceX,
  sourceY,
  targetX,
  targetY,
  tick,
  zoom,
}: {
  context: CanvasRenderingContext2D;
  distance: number | null;
  edgeId: string;
  fgStrong: string;
  highlighted: boolean;
  intensity: number;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  tick: number;
  zoom: number;
}) {
  const animatedTick = focusWaveTick(tick, distance, 7);
  const progress = (0.2 + pulse(animatedTick, `${edgeId}:contains-flow`, 0.7, 0)) % 1;
  const pulseX = sourceX + (targetX - sourceX) * progress;
  const pulseY = sourceY + (targetY - sourceY) * progress;

  context.save();
  context.globalAlpha = highlighted ? 0.08 + intensity * 0.18 : 0.1;
  context.fillStyle = fgStrong;
  context.beginPath();
  context.arc(pulseX, pulseY, 2.2 / zoom, 0, Math.PI * 2);
  context.fill();
  context.restore();
}
