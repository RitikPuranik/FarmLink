import { apiRequest } from "@/lib/apiClient";
import { CreateFarmInput, Farm, UpdateFarmInput } from "@/types/farmer";

export const farmApi = {
  async list() {
    const data = await apiRequest<{ farms: Farm[] }>("/api/farms");
    return data.farms;
  },

  async get(id: string) {
    const data = await apiRequest<{ farm: Farm }>(`/api/farms/${id}`);
    return data.farm;
  },

  async create(input: CreateFarmInput) {
    const data = await apiRequest<{ farm: Farm }>("/api/farms", { method: "POST", body: input });
    return data.farm;
  },

  async update(id: string, input: UpdateFarmInput) {
    const data = await apiRequest<{ farm: Farm }>(`/api/farms/${id}`, { method: "PATCH", body: input });
    return data.farm;
  },

  async remove(id: string) {
    await apiRequest<null>(`/api/farms/${id}`, { method: "DELETE" });
  },
};
