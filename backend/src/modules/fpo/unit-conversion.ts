/**
 * Unit normalization for Module 3's crop aggregation math (build spec
 * section 31/89: "the backend must normalize quantities before aggregation
 * — do not sum 100 KG + 100 QTL without conversion").
 *
 * FarmerCrop.yieldUnit (Module 2, crops.schemas.ts) is a free-text string —
 * there is no controlled vocabulary for it, farmers type things like
 * "QTL/ACRE" or "kg per hectare". This module only recognizes a small,
 * explicit set of forms; anything else is treated exactly like a missing
 * yield (build spec section 30: never invent a number).
 */

export type QuantityUnit = "KG" | "QTL" | "TONNE";
export type AreaUnit = "ACRE" | "HECTARE";

// Internal aggregation base unit — every intermediate sum is done in KG,
// converted to the caller's requested display unit only at the end.
export const BASE_QUANTITY_UNIT: QuantityUnit = "KG";

const QUANTITY_UNIT_TO_KG: Record<QuantityUnit, number> = {
  KG: 1,
  QTL: 100,
  TONNE: 1000,
};

// 1 hectare = 2.4710538147 acres (standard conversion factor).
const ACRE_PER_HECTARE = 2.4710538147;

export function convertQuantityToKg(value: number, unit: QuantityUnit): number {
  return value * QUANTITY_UNIT_TO_KG[unit];
}

export function convertKgToQuantity(valueKg: number, unit: QuantityUnit): number {
  return valueKg / QUANTITY_UNIT_TO_KG[unit];
}

export function convertArea(value: number, from: AreaUnit, to: AreaUnit): number {
  if (from === to) return value;
  // ACRE -> HECTARE or HECTARE -> ACRE
  return from === "HECTARE" ? value * ACRE_PER_HECTARE : value / ACRE_PER_HECTARE;
}

interface ParsedYieldUnit {
  quantityUnit: QuantityUnit;
  areaUnit: AreaUnit;
}

const QUANTITY_ALIASES: Record<string, QuantityUnit> = {
  KG: "KG",
  KGS: "KG",
  KILOGRAM: "KG",
  KILOGRAMS: "KG",
  QTL: "QTL",
  QUINTAL: "QTL",
  QUINTALS: "QTL",
  TONNE: "TONNE",
  TONNES: "TONNE",
  TON: "TONNE",
  TONS: "TONNE",
  MT: "TONNE",
};

const AREA_ALIASES: Record<string, AreaUnit> = {
  ACRE: "ACRE",
  ACRES: "ACRE",
  HECTARE: "HECTARE",
  HECTARES: "HECTARE",
  HA: "HECTARE",
};

/**
 * Parses free-text yieldUnit strings like "QTL/ACRE", "kg per hectare",
 * "Quintal/Acre". Returns null for anything unrecognized — callers must
 * treat that exactly like a missing typicalYield (build spec section 30),
 * never guess.
 */
export function parseYieldUnit(raw: string | null | undefined): ParsedYieldUnit | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, " ");
  const match = normalized.match(/^([A-Z]+)\s*(?:\/|PER)\s*([A-Z]+)$/);
  if (!match) return null;
  const quantityUnit = QUANTITY_ALIASES[match[1]];
  const areaUnit = AREA_ALIASES[match[2]];
  if (!quantityUnit || !areaUnit) return null;
  return { quantityUnit, areaUnit };
}

export type YieldEstimateStatus = "OK" | "MISSING_YIELD" | "UNRECOGNIZED_UNIT";

export interface YieldEstimate {
  estimatedQuantityKg: number | null;
  status: YieldEstimateStatus;
}

/**
 * Estimates one FarmerCrop row's quantity in KG.
 *
 * area is this crop's own allocated area (FarmerCrop.area/areaUnit — more
 * precise than the whole farm's area, since one farm can grow several
 * crops). typicalYield/yieldUnit come from the same row.
 *
 * Never invents a number (build spec section 29/30): a null/zero
 * typicalYield or an unparseable yieldUnit returns estimatedQuantityKg:
 * null with a status explaining why, rather than silently treating it as
 * zero or guessing a default yield.
 */
export function estimateFarmerCropQuantityKg(input: {
  area: number;
  areaUnit: AreaUnit;
  typicalYield: number | null | undefined;
  yieldUnit: string | null | undefined;
}): YieldEstimate {
  if (input.typicalYield === null || input.typicalYield === undefined || input.typicalYield <= 0) {
    return { estimatedQuantityKg: null, status: "MISSING_YIELD" };
  }
  const parsed = parseYieldUnit(input.yieldUnit);
  if (!parsed) {
    return { estimatedQuantityKg: null, status: "UNRECOGNIZED_UNIT" };
  }
  const areaInYieldUnit = convertArea(input.area, input.areaUnit, parsed.areaUnit);
  const quantityInYieldUnit = input.typicalYield * areaInYieldUnit;
  const quantityKg = convertQuantityToKg(quantityInYieldUnit, parsed.quantityUnit);
  return { estimatedQuantityKg: quantityKg, status: "OK" };
}
