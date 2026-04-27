import { buildDoorGlassItems } from "./door";
import { roundToPrecision, roundToSixteenth } from "./format";
import type { ComputedGlass, DoorOpening, GlassConfig, GlassItem, Lite } from "./types";

type GlassCandidate = GlassItem & {
  liteType: string;
};

export interface GlassTakeoffResult {
  computedGlass: ComputedGlass;
  storefrontMarks: Record<string, string>;
}

export interface DoorGlassCallout {
  mark: string;
  width: number;
  height: number;
}

export function buildGlassTakeoff(
  lites: Lite[],
  doorOpenings: DoorOpening[],
  glassConfig: GlassConfig
): GlassTakeoffResult {
  const grouped = new Map<
    string,
    {
      mark: string;
      locations: string[];
      qty: number;
      width: number;
      height: number;
      glassType: string;
      safetyGlazingLikely: boolean;
      sourceType: GlassItem["sourceType"];
      liteIds: string[];
    }
  >();
  const storefrontMarks: Record<string, string> = {};
  const candidates: GlassCandidate[] = [
    ...lites.map((lite) => ({
      liteId: lite.id,
      mark: "",
      location: getStorefrontLocation(lite),
      qty: lite.quantity,
      width: roundToSixteenth(lite.glassWidth),
      height: roundToSixteenth(lite.glassHeight),
      glassType: glassConfig.glassTypeLabel,
      safetyGlazingLikely: lite.safetyGlazingLikely,
      sourceType: "storefront-lite" as const,
      liteType: lite.type
    })),
    ...buildDoorGlassItems(doorOpenings, glassConfig.glassTypeLabel).map((item) => ({
      ...item,
      liteType: "door-lite" as const
    }))
  ];

  candidates.forEach((candidate) => {
    const key = [
      candidate.width,
      candidate.height,
      candidate.glassType,
      candidate.sourceType
    ].join("|");

    const current = grouped.get(key);
    if (current) {
      current.qty += candidate.qty;
      current.safetyGlazingLikely = current.safetyGlazingLikely || candidate.safetyGlazingLikely;
      current.locations.push(candidate.location);
      current.liteIds.push(candidate.liteId);
      return;
    }

    grouped.set(key, {
      mark: "",
      locations: [candidate.location],
      qty: candidate.qty,
      width: candidate.width,
      height: candidate.height,
      glassType: candidate.glassType,
      safetyGlazingLikely: candidate.safetyGlazingLikely,
      sourceType: candidate.sourceType,
      liteIds: [candidate.liteId]
    });
  });

  let storefrontIndex = 1;
  let doorIndex = 1;
  const items = Array.from(grouped.values()).map((group) => {
    const mark = group.sourceType === "door-lite" ? `DG${doorIndex++}` : `G${storefrontIndex++}`;

    if (group.sourceType === "storefront-lite") {
      group.liteIds.forEach((liteId) => {
        storefrontMarks[liteId] = mark;
      });
    }

    return {
      liteId: group.liteIds[0],
      mark,
      location: group.locations.join(", "),
      qty: group.qty,
      width: group.width,
      height: group.height,
      glassType: group.glassType,
      safetyGlazingLikely: group.safetyGlazingLikely,
      sourceType: group.sourceType
    };
  });

  return {
    computedGlass: { items },
    storefrontMarks
  };
}

export function getGlassItemSquareFeet(item: Pick<GlassItem, "width" | "height" | "qty">): number {
  return roundToPrecision((item.width * item.height) / 144, 2);
}

export function getGlassLineSquareFeet(item: Pick<GlassItem, "width" | "height" | "qty">): number {
  return roundToPrecision(getGlassItemSquareFeet(item) * item.qty, 2);
}

export function getTotalGlassSquareFeet(items: Array<Pick<GlassItem, "width" | "height" | "qty">>): number {
  return roundToPrecision(
    items.reduce((total, item) => total + getGlassLineSquareFeet(item), 0),
    2
  );
}

export function getDoorGlassCalloutMap(items: GlassItem[]): Record<string, DoorGlassCallout> {
  const callouts: Record<string, DoorGlassCallout> = {};

  items
    .filter((item) => item.sourceType === "door-lite")
    .forEach((item) => {
      item.location
        .split(",")
        .map((location) => location.trim())
        .filter(Boolean)
        .forEach((location) => {
          callouts[location] = {
            mark: item.mark,
            width: item.width,
            height: item.height
          };
        });
    });

  return callouts;
}

function getStorefrontLocation(lite: Lite): string {
  return `R${lite.rowIndex + 1}C${lite.columnIndex + 1}`;
}
