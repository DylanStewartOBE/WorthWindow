import { roundToPrecision } from "./format";
import type { Elevation, MemberRole, MemberSegment } from "./types";

export type MetalTakeoffRole = Exclude<MemberRole, "left-jamb" | "right-jamb"> | "jamb";

const METAL_ROLE_ORDER: MetalTakeoffRole[] = [
  "corner",
  "jamb",
  "door-jamb",
  "vertical-mullion",
  "head",
  "sill",
  "horizontal-mullion"
];

const METAL_ROLE_LABELS: Record<MetalTakeoffRole, string> = {
  corner: "Corner mullion",
  jamb: "Jamb",
  "door-jamb": "Door jamb",
  "vertical-mullion": "Intermediate vertical",
  head: "Head",
  sill: "Sill",
  "horizontal-mullion": "Horizontal"
};

export interface MetalTakeoffLine {
  role: MetalTakeoffRole;
  label: string;
  qty: number;
  averageLengthInches: number;
  totalLengthInches: number;
  totalLinearFeet: number;
  elevationBreakdown: Array<{
    label: string;
    qty: number;
  }>;
}

export interface MetalTakeoffSummary {
  items: MetalTakeoffLine[];
  totalLinearFeet: number;
}

export function buildMetalTakeoff(elevations: Elevation[]): MetalTakeoffSummary {
  const groups = new Map<
    MetalTakeoffRole,
    {
      qty: number;
      totalLengthInches: number;
      elevationCounts: Map<string, number>;
    }
  >();

  elevations.forEach((elevation, elevationIndex) => {
    const elevationLabel = `E${elevationIndex + 1}`;
    elevation.computedGeometry.members.forEach((member) => {
      const length = getMemberLengthInches(member);
      if (length <= 0) return;
      const role = getMetalTakeoffRole(member.role);

      const current =
        groups.get(role) ??
        {
          qty: 0,
          totalLengthInches: 0,
          elevationCounts: new Map<string, number>()
        };
      current.qty += 1;
      current.totalLengthInches += length;
      current.elevationCounts.set(elevationLabel, (current.elevationCounts.get(elevationLabel) ?? 0) + 1);
      groups.set(role, current);
    });
  });

  const items = METAL_ROLE_ORDER.flatMap((role) => {
    const group = groups.get(role);
    if (!group) return [];

    return [
      {
        role,
        label: METAL_ROLE_LABELS[role],
        qty: group.qty,
        averageLengthInches: roundToPrecision(group.totalLengthInches / group.qty, 2),
        totalLengthInches: roundToPrecision(group.totalLengthInches, 2),
        totalLinearFeet: roundToPrecision(group.totalLengthInches / 12, 2),
        elevationBreakdown: Array.from(group.elevationCounts.entries()).map(([label, qty]) => ({ label, qty }))
      }
    ];
  });

  return {
    items,
    totalLinearFeet: roundToPrecision(
      items.reduce((total, item) => total + item.totalLengthInches, 0) / 12,
      2
    )
  };
}

export function getMemberLengthInches(member: Pick<MemberSegment, "width" | "height">): number {
  return roundToPrecision(Math.max(member.width, member.height));
}

function getMetalTakeoffRole(role: MemberRole): MetalTakeoffRole {
  return role === "left-jamb" || role === "right-jamb" ? "jamb" : role;
}
