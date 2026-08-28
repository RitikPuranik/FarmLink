import type { ReferenceDataRepository } from "../../src/modules/reference-data/reference-data.repository";
import {
  FIXTURE_CROPS,
  FIXTURE_CROP_TRANSLATIONS,
  FIXTURE_DISTRICTS,
  FIXTURE_FPOS,
  FIXTURE_STATES,
  FIXTURE_TALUKAS,
} from "./referenceDataFixtures";

export class InMemoryReferenceDataRepository implements ReferenceDataRepository {
  states = FIXTURE_STATES.map((s) => ({ ...s }));
  districts = FIXTURE_DISTRICTS.map((d) => ({ ...d }));
  talukas = FIXTURE_TALUKAS.map((t) => ({ ...t }));
  crops = FIXTURE_CROPS.map((c) => ({ ...c }));
  cropTranslations = FIXTURE_CROP_TRANSLATIONS.map((t) => ({ ...t }));
  fpos = FIXTURE_FPOS.map((f) => ({ ...f }));

  async listStates() {
    return this.states as never;
  }

  async findStateById(id: string) {
    return (this.states.find((s) => s.id === id) as never) ?? null;
  }

  async listDistricts(stateId: string) {
    return this.districts.filter((d) => d.stateId === stateId) as never;
  }

  async findDistrictById(id: string) {
    return (this.districts.find((d) => d.id === id) as never) ?? null;
  }

  async listTalukas(districtId: string) {
    return this.talukas.filter((t) => t.districtId === districtId) as never;
  }

  async findTalukaById(id: string) {
    return (this.talukas.find((t) => t.id === id) as never) ?? null;
  }

  async listCrops() {
    return this.crops
      .filter((c) => c.active)
      .map((c) => ({ ...c, translations: this.cropTranslations.filter((t) => t.cropId === c.id) })) as never;
  }

  async findCropById(id: string) {
    return (this.crops.find((c) => c.id === id) as never) ?? null;
  }

  async findManyCropsByIds(ids: string[]) {
    return this.crops.filter((c) => ids.includes(c.id)) as never;
  }

  async listFpos(districtId?: string) {
    return this.fpos.filter((f) => f.active && (!districtId || f.districtId === districtId)) as never;
  }

  async findFpoById(id: string) {
    return (this.fpos.find((f) => f.id === id) as never) ?? null;
  }
}
