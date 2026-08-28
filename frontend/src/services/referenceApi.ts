import { apiRequest } from "@/lib/apiClient";
import {
  CropOption,
  DistrictOption,
  FpoOption,
  IrrigationTypeOption,
  LanguageOption,
  StateOption,
  TalukaOption,
} from "@/types/farmer";

export const referenceApi = {
  async languages() {
    const data = await apiRequest<{ languages: LanguageOption[] }>("/api/reference/languages");
    return data.languages;
  },

  async irrigationTypes() {
    const data = await apiRequest<{ irrigationTypes: IrrigationTypeOption[] }>("/api/reference/irrigation-types");
    return data.irrigationTypes;
  },

  async states() {
    const data = await apiRequest<{ states: StateOption[] }>("/api/reference/states");
    return data.states;
  },

  async districts(stateId: string) {
    const data = await apiRequest<{ districts: DistrictOption[] }>(
      `/api/reference/districts?stateId=${encodeURIComponent(stateId)}`,
    );
    return data.districts;
  },

  async talukas(districtId: string) {
    const data = await apiRequest<{ talukas: TalukaOption[] }>(
      `/api/reference/talukas?districtId=${encodeURIComponent(districtId)}`,
    );
    return data.talukas;
  },

  async crops() {
    const data = await apiRequest<{ crops: CropOption[] }>("/api/reference/crops");
    return data.crops;
  },

  async fpos(districtId?: string) {
    const query = districtId ? `?districtId=${encodeURIComponent(districtId)}` : "";
    const data = await apiRequest<{ fpos: FpoOption[] }>(`/api/reference/fpos${query}`);
    return data.fpos;
  },
};
