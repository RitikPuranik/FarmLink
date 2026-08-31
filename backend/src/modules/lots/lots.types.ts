import { Crop, CropLot, CropLotStatus, Farm, Fpo, LotOwnerType, LotSourceType, QuantityUnit } from "@prisma/client";
import { convertKgToQuantity } from "../fpo/unit-conversion";

export type CropLotWithRelations = CropLot & {
  crop: Crop;
  farm: Farm | null;
  fpo: Fpo | null;
};

export interface LotStatusHistoryEntryDTO {
  fromStatus: CropLotStatus | null;
  toStatus: CropLotStatus;
  changedBy: string | null;
  reason: string | null;
  createdAt: string;
}

// Build spec section 70: {value, unit, quantityKg} for the base quantity,
// {value, unit} for the (usually smaller, post-reservation) available
// quantity — same unit as the lot's own `unit` unless a display unit is
// explicitly requested.
export interface LotQuantityDTO {
  value: number;
  unit: QuantityUnit;
  quantityKg: number;
}

export interface LotAvailableQuantityDTO {
  value: number;
  unit: QuantityUnit;
}

export interface CropLotDTO {
  publicId: string;
  lotNumber: string;
  ownerType: LotOwnerType;
  sourceType: LotSourceType;
  crop: { id: string; name: string };
  farm: { id: string } | null;
  fpo: { publicId: string; name: string } | null;
  variety: string | null;
  quantity: LotQuantityDTO;
  availableQuantity: LotAvailableQuantityDTO;
  origin: {
    village: string | null;
    taluka: string | null;
    district: string;
    state: string;
  };
  status: CropLotStatus;
  harvestDate: string | null;
  availabilityDate: string;
  // A URL the lot's QR code should encode (build spec section 39/40) — no
  // farmer contact info, coordinates or other private data, just a
  // resolvable public/authorized reference. Rendering an actual QR image
  // is left to the frontend (or a future module) — see that section's
  // "do not implement external public lot pages unless needed".
  qrCodeValue: string;
  createdAt: string;
  updatedAt: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toCropLotDTO(
  lot: CropLotWithRelations,
  frontendUrl: string,
  displayUnit?: QuantityUnit,
): CropLotDTO {
  const unit = displayUnit ?? lot.unit;
  const quantityKg = Number(lot.quantityKg);
  const availableQuantityKg = Number(lot.availableQuantityKg);

  return {
    publicId: lot.publicId,
    lotNumber: lot.lotNumber,
    ownerType: lot.ownerType,
    sourceType: lot.sourceType,
    crop: { id: lot.crop.id, name: lot.crop.name },
    farm: lot.farm ? { id: lot.farm.id } : null,
    fpo: lot.fpo ? { publicId: lot.fpo.publicId, name: lot.fpo.name } : null,
    variety: lot.variety,
    quantity: {
      value: round2(convertKgToQuantity(quantityKg, unit)),
      unit,
      quantityKg: round2(quantityKg),
    },
    availableQuantity: {
      value: round2(convertKgToQuantity(availableQuantityKg, unit)),
      unit,
    },
    origin: {
      village: lot.originVillage,
      taluka: lot.originTaluka,
      district: lot.originDistrict,
      state: lot.originState,
    },
    status: lot.status,
    harvestDate: lot.harvestDate ? lot.harvestDate.toISOString() : null,
    availabilityDate: lot.availabilityDate.toISOString(),
    qrCodeValue: `${frontendUrl.replace(/\/$/, "")}/lots/${lot.publicId}`,
    createdAt: lot.createdAt.toISOString(),
    updatedAt: lot.updatedAt.toISOString(),
  };
}

export interface FarmerLotSummaryDTO {
  totalLots: number;
  draftLots: number;
  availableLots: number;
  cancelledLots: number;
  totalAvailableQuantityKg: number;
}
