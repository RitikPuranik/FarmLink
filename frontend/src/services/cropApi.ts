import { apiRequest } from "@/lib/apiClient";
import { AddFarmerCropInput, FarmerCrop, UpdateFarmerCropInput } from "@/types/farmer";

export const cropApi = {
  async list() {
    const data = await apiRequest<{ crops: FarmerCrop[] }>("/api/farmers/me/crops");
    return data.crops;
  },

  async add(input: AddFarmerCropInput) {
    const data = await apiRequest<{ crop: FarmerCrop }>("/api/farmers/me/crops", { method: "POST", body: input });
    return data.crop;
  },

  async update(id: string, input: UpdateFarmerCropInput) {
    const data = await apiRequest<{ crop: FarmerCrop }>(`/api/farmers/me/crops/${id}`, {
      method: "PATCH",
      body: input,
    });
    return data.crop;
  },

  async remove(id: string) {
    await apiRequest<null>(`/api/farmers/me/crops/${id}`, { method: "DELETE" });
  },
};
