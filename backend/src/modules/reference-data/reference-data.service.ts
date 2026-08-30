import { CropTranslation, Language } from "@prisma/client";
import { NotFoundError, ValidationError } from "../../common/errors";
import { ReferenceDataRepository } from "./reference-data.repository";

export interface StateDTO {
  id: string;
  name: string;
}

export interface DistrictDTO {
  id: string;
  stateId: string;
  name: string;
}

export interface TalukaDTO {
  id: string;
  districtId: string;
  name: string;
}

export interface CropDTO {
  id: string;
  name: string;
  category: string | null;
  translations: Partial<Record<Language, string>>;
}

export interface FpoDTO {
  id: string;
  name: string;
  districtId: string | null;
}

// Static — these are not database-backed reference data (build spec
// section 31 lists them alongside DB-backed reference data, but there is
// nothing to normalize/seed: the supported set is exactly the Language
// enum and the IrrigationType enum already declared in schema.prisma).
const LANGUAGES: { code: Language; label: string }[] = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिंदी" },
  { code: "mr", label: "मराठी" },
];

const IRRIGATION_TYPES: { code: string; labelKey: string }[] = [
  { code: "RAINFED", labelKey: "irrigation.RAINFED" },
  { code: "CANAL", labelKey: "irrigation.CANAL" },
  { code: "BOREWELL", labelKey: "irrigation.BOREWELL" },
  { code: "DRIP", labelKey: "irrigation.DRIP" },
  { code: "SPRINKLER", labelKey: "irrigation.SPRINKLER" },
  { code: "MIXED", labelKey: "irrigation.MIXED" },
  { code: "OTHER", labelKey: "irrigation.OTHER" },
  { code: "NOT_SPECIFIED", labelKey: "irrigation.NOT_SPECIFIED" },
];

export class ReferenceDataService {
  constructor(private readonly repo: ReferenceDataRepository) {}

  listLanguages() {
    return LANGUAGES;
  }

  listIrrigationTypes() {
    return IRRIGATION_TYPES;
  }

  async listStates(): Promise<StateDTO[]> {
    const states = await this.repo.listStates();
    return states.map((s) => ({ id: s.id, name: s.name }));
  }

  async listDistricts(stateId: string): Promise<DistrictDTO[]> {
    const state = await this.repo.findStateById(stateId);
    if (!state) {
      throw new NotFoundError("The selected state was not found.");
    }
    const districts = await this.repo.listDistricts(stateId);
    return districts.map((d) => ({ id: d.id, stateId: d.stateId, name: d.name }));
  }

  async listTalukas(districtId: string): Promise<TalukaDTO[]> {
    const district = await this.repo.findDistrictById(districtId);
    if (!district) {
      throw new NotFoundError("The selected district was not found.");
    }
    const talukas = await this.repo.listTalukas(districtId);
    return talukas.map((t) => ({ id: t.id, districtId: t.districtId, name: t.name }));
  }

  async listCrops(): Promise<CropDTO[]> {
    const crops = await this.repo.listCrops();
    return crops.map((crop) => ({
      id: crop.id,
      name: crop.name,
      category: crop.category,
      translations: Object.fromEntries(crop.translations.map((t: CropTranslation) => [t.language, t.localizedName])),
    }));
  }

  async listFpos(districtId?: string): Promise<FpoDTO[]> {
    if (districtId) {
      const district = await this.repo.findDistrictById(districtId);
      if (!district) {
        throw new NotFoundError("The selected district was not found.");
      }
    }
    const fpos = await this.repo.listFpos(districtId);
    return fpos.map((f) => ({ id: f.id, name: f.name, districtId: f.districtId }));
  }

  async getFpoById(fpoId: string): Promise<FpoDTO | null> {
    const fpo = await this.repo.findFpoById(fpoId);
    if (!fpo || !fpo.active) return null;
    return { id: fpo.id, name: fpo.name, districtId: fpo.districtId };
  }

  /**
   * Build spec section 22: "Do not allow arbitrary FPO IDs from the
   * client. The backend must verify that the referenced FPO exists."
   * Section 58 categorizes an invalid FPO as 400/404 — ValidationError is
   * used here since it's the caller's request that's malformed (a
   * dangling/unknown id), not a resource lookup by primary key.
   */
  async assertFpoExists(fpoId: string): Promise<void> {
    const fpo = await this.repo.findFpoById(fpoId);
    if (!fpo || !fpo.active) {
      throw new ValidationError("Please correct the highlighted fields", { fpoId: "Unknown or inactive FPO." });
    }
  }

  /**
   * Build spec section 30/46/58: crop ids must be validated server-side
   * ("Invalid crop -> 400 Validation Error"), never trusted from the
   * client as-is.
   */
  async getActiveCropOrThrow(cropId: string) {
    const crop = await this.repo.findCropById(cropId);
    if (!crop || !crop.active) {
      throw new ValidationError("Please correct the highlighted fields", { cropId: "Unknown or inactive crop." });
    }
    return crop;
  }

  /**
   * Validates that a district really belongs to a state (build spec
   * section 46/58). Split out from assertValidLocationChain below so
   * Module 3 (FPO registration, where taluka is optional — not every FPO
   * maps neatly onto one taluka the way a single farm does) can reuse the
   * state/district half without being forced to supply a talukaId.
   */
  async assertValidStateDistrict(input: { stateId: string; districtId: string }) {
    const state = await this.repo.findStateById(input.stateId);
    if (!state) {
      throw new ValidationError("Please correct the highlighted fields", { stateId: "Unknown state." });
    }

    const district = await this.repo.findDistrictById(input.districtId);
    if (!district || district.stateId !== state.id) {
      throw new ValidationError("Please correct the highlighted fields", {
        districtId: "This district does not belong to the selected state.",
      });
    }

    return { state, district };
  }

  /**
   * Validates that a district belongs to a taluka's parent district (build
   * spec section 46/58). Split out for the same reason as
   * assertValidStateDistrict above.
   */
  async assertValidTalukaInDistrict(districtId: string, talukaId: string) {
    const taluka = await this.repo.findTalukaById(talukaId);
    if (!taluka || taluka.districtId !== districtId) {
      throw new ValidationError("Please correct the highlighted fields", {
        talukaId: "This taluka does not belong to the selected district.",
      });
    }
    return taluka;
  }

  /**
   * Validates that a state/district/taluka form a real, consistent chain
   * (build spec section 46: "validate location IDs" + section 8: "validate
   * on backend"). Used by the farms module when creating/updating a farm so
   * a district can never be attached to the wrong state, etc.
   */
  async assertValidLocationChain(input: { stateId: string; districtId: string; talukaId: string }) {
    const { state, district } = await this.assertValidStateDistrict(input);
    const taluka = await this.assertValidTalukaInDistrict(district.id, input.talukaId);
    return { state, district, taluka };
  }
}
