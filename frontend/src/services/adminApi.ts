import { apiRequest } from "@/lib/apiClient";
import { FpoSummary } from "@/types/domain";

function unwrapList<T>(data: any, key: string): T[] {
  if (Array.isArray(data)) return data;
  if (data?.[key]) return data[key];
  if (data?.items) return data.items;
  return [];
}

export interface PlatformUser {
  publicId: string;
  fullName: string;
  mobile: string;
  email: string | null;
  role: string;
  accountStatus: string;
  createdAt: string;
}

export const adminApi = {
  async users() {
    const data = await apiRequest<any>("/api/admin/users");
    return unwrapList<PlatformUser>(data, "users");
  },

  async fpos(params?: { name?: string }) {
    const qs = params?.name ? `?name=${encodeURIComponent(params.name)}` : "";
    const data = await apiRequest<any>(`/api/admin/fpos${qs}`);
    return unwrapList<FpoSummary>(data, "fpos");
  },

  async fpoDetails(fpoId: string) {
    const data = await apiRequest<any>(`/api/admin/fpos/${fpoId}`);
    return (data?.fpo ?? data) as FpoSummary;
  },

  async verifyFpo(fpoId: string) {
    return apiRequest<any>(`/api/admin/fpos/${fpoId}/verify`, { method: "POST", body: {} });
  },

  async rejectFpo(fpoId: string, reason?: string) {
    return apiRequest<any>(`/api/admin/fpos/${fpoId}/reject`, { method: "POST", body: reason ? { reason } : {} });
  },

  async suspendFpo(fpoId: string) {
    return apiRequest<any>(`/api/admin/fpos/${fpoId}/suspend`, { method: "POST" });
  },

  async reactivateFpo(fpoId: string) {
    return apiRequest<any>(`/api/admin/fpos/${fpoId}/reactivate`, { method: "POST" });
  },

  async fpoAdmins(fpoId: string) {
    const data = await apiRequest<any>(`/api/admin/fpos/${fpoId}/admins`);
    return unwrapList<any>(data, "admins");
  },

  async triggerWarehouseSync(provider?: string) {
    return apiRequest<any>("/api/admin/warehouses/sync", { method: "POST", body: provider ? { provider } : {} });
  },
};

export const governmentApi = {
  async fpoSummary() {
    return apiRequest<any>("/api/government/fpo-summary");
  },
};
