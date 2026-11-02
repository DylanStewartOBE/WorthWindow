import { formatQty, roundCurrency } from "./math";
import type { PlumbingConfig, PlumbingJob, PlumbingTakeoff, TakeoffLineKind } from "./types";

export interface ShoppingItem {
  key: string;
  section: string;
  brandKey: string;
  brand: string;
  description: string;
  sizeLabel: string;
  qty: number;
  unit: string;
  orderText: string;
  unitCost: number;
  extCost: number;
}

export interface ShoppingSection {
  name: string;
  items: ShoppingItem[];
  total: number;
}

export interface ShoppingList {
  sections: ShoppingSection[];
  total: number;
}

const SECTION_BY_KIND: Partial<Record<TakeoffLineKind, string>> = {
  pipe: "Pipe",
  fitting: "Fittings",
  kit: "Rough-in & trim materials",
  hanger: "Hangers & supports",
  insulation: "Insulation",
  "site-material": "Site & excavation materials",
  fixture: "Fixtures & equipment",
  excavation: "Equipment rental"
};

const SECTION_ORDER = Object.values(SECTION_BY_KIND);

/** Brand options for a catalog group. A brand the user typed for this job is always included. */
export function getBrandOptions(brandKey: string, config: PlumbingConfig, job?: PlumbingJob): string[] {
  const [kind, id] = brandKey.split(":");
  let options: string[] = [];
  if (kind === "pipe" || kind === "fitting") {
    const material = config.pipingRulePack.pipeMaterials.find((candidate) => candidate.id === id);
    options = (kind === "pipe" ? material?.brands : material?.fittingBrands) ?? [];
  } else if (kind === "material") {
    options = config.materialCatalog.materials.find((candidate) => candidate.id === id)?.brands ?? [];
  }
  const chosen = job?.brandChoices[brandKey];
  return chosen && !options.includes(chosen) ? [...options, chosen] : options;
}

export function resolveBrand(brandKey: string, config: PlumbingConfig, job: PlumbingJob): string {
  return job.brandChoices[brandKey] ?? getBrandOptions(brandKey, config)[0] ?? "";
}

/**
 * Purchase list built from the takeoff: phases are combined, labor is dropped, pipe is listed in
 * stock lengths, and each item carries the brand picked for its catalog group.
 */
export function buildShoppingList(takeoff: PlumbingTakeoff, job: PlumbingJob, config: PlumbingConfig): ShoppingList {
  const pipeMaterials = new Map(config.pipingRulePack.pipeMaterials.map((material) => [material.id, material]));
  const items = new Map<string, ShoppingItem>();

  takeoff.materials.forEach((line) => {
    const section = SECTION_BY_KIND[line.kind];
    if (!section) return;
    if (line.kind === "fixture" && line.unitCost === 0) return; // furnished by others
    if (line.kind === "excavation" && line.unitCost === 0) return; // labor-only excavation lines

    const key = line.key.split("|").slice(1).join("|");
    const brandKey = line.brandKey ?? "";
    const qty = line.kind === "pipe" ? line.orderQty : line.orderQty || line.qty;
    const existing = items.get(key);
    if (existing) {
      existing.qty += qty;
      existing.extCost = roundCurrency(existing.extCost + line.materialCost);
      return;
    }
    items.set(key, {
      key,
      section,
      brandKey,
      brand: brandKey ? resolveBrand(brandKey, config, job) : "",
      description: line.description,
      sizeLabel: line.sizeLabel ?? "",
      qty,
      unit: line.unit,
      orderText: "",
      unitCost: line.unitCost,
      extCost: line.materialCost
    });
  });

  items.forEach((item) => {
    if (item.section === "Pipe") {
      const material = pipeMaterials.get(item.brandKey.split(":")[1]);
      const stock = material?.stickLengthFt ?? 0;
      const count = stock ? Math.round(item.qty / stock) : 0;
      const word = stock >= 50 ? (count === 1 ? "coil" : "coils") : count === 1 ? "stick" : "sticks";
      item.orderText = stock ? `${count} x ${stock}' ${word}` : `${formatQty(item.qty)} ft`;
    } else {
      item.orderText = `${formatQty(Math.ceil(item.qty - 1e-9))} ${item.unit}`;
    }
  });

  const sections = SECTION_ORDER.map((name) => {
    const sectionItems = [...items.values()]
      .filter((item) => item.section === name)
      .sort((a, b) => a.description.localeCompare(b.description) || a.sizeLabel.localeCompare(b.sizeLabel));
    return { name, items: sectionItems, total: roundCurrency(sectionItems.reduce((total, item) => total + item.extCost, 0)) };
  }).filter((section) => section.items.length > 0);

  return { sections, total: roundCurrency(sections.reduce((total, section) => total + section.total, 0)) };
}

/** Plain text for pasting into a text or email to a supplier. */
export function shoppingListText(list: ShoppingList, job: PlumbingJob): string {
  const header = [`${job.name}${job.number ? ` (${job.number})` : ""} - plumbing material list`, `Rev ${job.revision}`];
  const body = list.sections.flatMap((section) => [
    "",
    section.name.toUpperCase(),
    ...section.items.map((item) => `- ${item.orderText}  ${[item.brand, item.description].filter(Boolean).join(" ")}`)
  ]);
  return [...header, ...body].join("\n");
}

export function shoppingListCsv(list: ShoppingList): string {
  const header = ["Section", "Brand", "Description", "Size", "Order", "Qty", "Unit", "Unit cost", "Ext cost"];
  const rows = list.sections.flatMap((section) =>
    section.items.map((item) => [
      section.name,
      item.brand,
      item.description,
      item.sizeLabel,
      item.orderText,
      formatQty(item.qty),
      item.unit,
      item.unitCost.toFixed(2),
      item.extCost.toFixed(2)
    ])
  );
  return [header, ...rows].map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")).join("\n");
}
