import { AreaUnit, CropTranslation, Language } from "@prisma/client";
import { FarmerCropWithCrop } from "./farmer-crop.repository";

export interface FarmerCropDTO {
  id: string;
  farmId: string;
  crop: {
    id: string;
    name: string;
    category: string | null;
    translations: Partial<Record<Language, string>>;
  };
  area: number;
  areaUnit: AreaUnit;
  isPrimary: boolean;
  typicalYield: number | null;
  yieldUnit: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toFarmerCropDTO(fc: FarmerCropWithCrop): FarmerCropDTO {
  return {
    id: fc.id,
    farmId: fc.farmId,
    crop: {
      id: fc.crop.id,
      name: fc.crop.name,
      category: fc.crop.category,
      translations: Object.fromEntries(
        fc.crop.translations.map((t: CropTranslation) => [t.language, t.localizedName]),
      ),
    },
    area: fc.area,
    areaUnit: fc.areaUnit,
    isPrimary: fc.isPrimary,
    typicalYield: fc.typicalYield,
    yieldUnit: fc.yieldUnit,
    createdAt: fc.createdAt.toISOString(),
    updatedAt: fc.updatedAt.toISOString(),
  };
}
