import { apiRequest } from "@/lib/apiClient";
import { CreateLotInput, CropLot, LotHistoryEntry, LotSummary } from "@/types/domain";

function unwrapList<T>(data: any, key: string): T[] {
  if (Array.isArray(data)) return data;
  if (data?.[key]) return data[key];
  if (data?.items) return data.items;
  return [];
}

export const lotApi = {
  async listMine(params?: { status?: string; cropId?: string; farmId?: string }) {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.cropId) q.set("cropId", params.cropId);
    if (params?.farmId) q.set("farmId", params.farmId);
    const qs = q.toString();
    const data = await apiRequest<any>(`/api/lots${qs ? `?${qs}` : ""}`);
    return unwrapList<CropLot>(data, "lots");
  },

  async summary() {
    return apiRequest<LotSummary>("/api/farmers/me/lots/summary");
  },

  async get(id: string) {
    const data = await apiRequest<any>(`/api/lots/${id}`);
    return (data?.lot ?? data) as CropLot;
  },

  async create(input: CreateLotInput) {
    const data = await apiRequest<any>("/api/lots", { method: "POST", body: input });
    return (data?.lot ?? data) as CropLot;
  },

  async updateDraft(id: string, input: Partial<CreateLotInput>) {
    const data = await apiRequest<any>(`/api/lots/${id}`, { method: "PATCH", body: input });
    return (data?.lot ?? data) as CropLot;
  },

  async remove(id: string) {
    await apiRequest<null>(`/api/lots/${id}`, { method: "DELETE" });
  },

  async publish(id: string) {
    const data = await apiRequest<any>(`/api/lots/${id}/publish`, { method: "POST" });
    return (data?.lot ?? data) as CropLot;
  },

  async cancel(id: string) {
    const data = await apiRequest<any>(`/api/lots/${id}/cancel`, { method: "POST" });
    return (data?.lot ?? data) as CropLot;
  },

  async history(id: string) {
    const data = await apiRequest<any>(`/api/lots/${id}/history`);
    return unwrapList<LotHistoryEntry>(data, "history");
  },

  async listForFpo(fpoId: string) {
    const data = await apiRequest<any>(`/api/fpos/${fpoId}/lots`);
    return unwrapList<CropLot>(data, "lots");
  },
};
