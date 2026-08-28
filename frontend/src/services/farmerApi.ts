import { apiRequest } from "@/lib/apiClient";
import { FarmerProfileAggregate, FarmerProfileInput, ProfileCompletion } from "@/types/farmer";

export const farmerApi = {
  async getMe() {
    return apiRequest<FarmerProfileAggregate>("/api/farmers/me");
  },

  async createProfile(input: FarmerProfileInput) {
    return apiRequest<FarmerProfileAggregate>("/api/farmers/me/profile", { method: "POST", body: input });
  },

  async updateProfile(input: FarmerProfileInput) {
    return apiRequest<FarmerProfileAggregate>("/api/farmers/me/profile", { method: "PATCH", body: input });
  },

  async completion() {
    return apiRequest<ProfileCompletion>("/api/farmers/me/completion");
  },
};
