const MIN_NODE_HIT_RADIUS_PX = 28;
const NODE_DRAG_THRESHOLD_PX = 3;

export function graphNodeHitRadius(radius: number, screenScale: number): number {
  const safeScreenScale = Math.max(0.01, screenScale);
  return Math.max(radius + 10, MIN_NODE_HIT_RADIUS_PX / safeScreenScale);
}

export function nodeDragExceededThreshold({
  currentX,
  currentY,
  startX,
  startY,
}: {
  currentX: number;
  currentY: number;
  startX: number;
  startY: number;
}): boolean {
  return Math.hypot(currentX - startX, currentY - startY) >= NODE_DRAG_THRESHOLD_PX;
}
