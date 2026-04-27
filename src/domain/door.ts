import { roundToPrecision, roundToSixteenth } from "./format";
import type { DoorOpening, GlassItem } from "./types";

export const STANDARD_DOOR_TOP_RAIL = 4;
export const STANDARD_DOOR_BOTTOM_RAIL = 10;
export const STANDARD_DOOR_STILE = 4;

export type DoorHingeSide = "left" | "right";
export type DoorLeafMemberRole = "left-stile" | "right-stile" | "top-rail" | "bottom-rail";

export interface DoorLeafMemberRect {
  role: DoorLeafMemberRole;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DoorLeafVisual {
  leafIndex: number;
  leafX: number;
  leafWidth: number;
  leafHeight: number;
  hingeSide: DoorHingeSide;
  topRail: number;
  bottomRail: number;
  stile: number;
  members: DoorLeafMemberRect[];
  glassX: number;
  glassY: number;
  glassWidth: number;
  glassHeight: number;
  guideStartTop: { x: number; y: number };
  guideStartBottom: { x: number; y: number };
  guideEnd: { x: number; y: number };
}

export function getDoorLeafVisuals(door: Pick<DoorOpening, "width" | "height" | "leafCount">): DoorLeafVisual[] {
  const leafWidth = roundToPrecision(door.width / door.leafCount);

  return Array.from({ length: door.leafCount }, (_, leafIndex) => {
    const leafX = roundToPrecision(leafIndex * leafWidth);
    const hingeSide = getDoorHingeSide(door.leafCount, leafIndex);
    const glassX = roundToPrecision(leafX + STANDARD_DOOR_STILE);
    const glassY = STANDARD_DOOR_TOP_RAIL;
    const glassWidth = roundToPrecision(Math.max(leafWidth - STANDARD_DOOR_STILE * 2, 0));
    const glassHeight = roundToPrecision(
      Math.max(door.height - STANDARD_DOOR_TOP_RAIL - STANDARD_DOOR_BOTTOM_RAIL, 0)
    );
    const guideStartX = hingeSide === "left" ? leafX + leafWidth : leafX;
    const guideEndX = hingeSide === "left" ? leafX : leafX + leafWidth;
    const guideEndY = roundToPrecision(door.height / 2);
    const members: DoorLeafMemberRect[] = [
      {
        role: "left-stile",
        x: leafX,
        y: 0,
        width: STANDARD_DOOR_STILE,
        height: door.height
      },
      {
        role: "right-stile",
        x: roundToPrecision(leafX + leafWidth - STANDARD_DOOR_STILE),
        y: 0,
        width: STANDARD_DOOR_STILE,
        height: door.height
      },
      {
        role: "top-rail",
        x: roundToPrecision(leafX + STANDARD_DOOR_STILE),
        y: 0,
        width: roundToPrecision(Math.max(leafWidth - STANDARD_DOOR_STILE * 2, 0)),
        height: STANDARD_DOOR_TOP_RAIL
      },
      {
        role: "bottom-rail",
        x: roundToPrecision(leafX + STANDARD_DOOR_STILE),
        y: roundToPrecision(door.height - STANDARD_DOOR_BOTTOM_RAIL),
        width: roundToPrecision(Math.max(leafWidth - STANDARD_DOOR_STILE * 2, 0)),
        height: STANDARD_DOOR_BOTTOM_RAIL
      }
    ];

    return {
      leafIndex,
      leafX,
      leafWidth,
      leafHeight: door.height,
      hingeSide,
      topRail: STANDARD_DOOR_TOP_RAIL,
      bottomRail: STANDARD_DOOR_BOTTOM_RAIL,
      stile: STANDARD_DOOR_STILE,
      members,
      glassX,
      glassY,
      glassWidth,
      glassHeight,
      guideStartTop: { x: guideStartX, y: 0 },
      guideStartBottom: { x: guideStartX, y: door.height },
      guideEnd: { x: guideEndX, y: guideEndY }
    };
  });
}

export function buildDoorGlassItems(
  doors: DoorOpening[],
  glassType: string
): GlassItem[] {
  const items: GlassItem[] = [];

  doors.forEach((door, doorIndex) => {
    getDoorLeafVisuals(door).forEach((leaf) => {
      items.push({
        liteId: `door-glass-${door.id}-${leaf.leafIndex + 1}`,
        mark: "",
        location: `D${doorIndex + 1}L${leaf.leafIndex + 1}`,
        qty: 1,
        width: roundToSixteenth(leaf.glassWidth),
        height: roundToSixteenth(leaf.glassHeight),
        glassType,
        safetyGlazingLikely: true,
        sourceType: "door-lite"
      });
    });
  });

  return items;
}

function getDoorHingeSide(leafCount: number, leafIndex: number): DoorHingeSide {
  if (leafCount === 1) return "left";
  return leafIndex === 0 ? "left" : "right";
}
