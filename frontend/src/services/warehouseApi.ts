import { apiRequest } from "@/lib/apiClient";

function unwrapList<T>(data: any, key: string): T[] {
  if (Array.isArray(data)) return data;
  if (data?.[key]) return data[key];
  if (data?.items) return data.items;
  return [];
}

export const warehouseApi = {
  async nearby(params: { latitude: number; longitude: number; radiusKm?: number; cropId?: string; quantity?: number; unit?: string }) {
    const q = new URLSearchParams();
    q.set("latitude", String(params.latitude));
    q.set("longitude", String(params.longitude));
    if (params.radiusKm) q.set("radiusKm", String(params.radiusKm));
    if (params.cropId) q.set("cropId", params.cropId);
    if (params.quantity) q.set("quantity", String(params.quantity));
    if (params.unit) q.set("unit", params.unit);
    const data = await apiRequest<any>(`/api/warehouses/nearby?${q.toString()}`);
    return unwrapList<any>(data, "warehouses");
  },

  async recommend(body: { cropId: string; latitude?: number; longitude?: number; radiusKm?: number; quantity?: number; unit?: string; durationDays?: number }) {
    return apiRequest<any>("/api/warehouses/recommend", { method: "POST", body });
  },

  async detail(warehouseId: string) {
    return apiRequest<any>(`/api/warehouses/${warehouseId}`);
  },

  async availability(warehouseId: string, params?: { cropId?: string; quantity?: number; unit?: string }) {
    const q = new URLSearchParams();
    if (params?.cropId) q.set("cropId", params.cropId);
    if (params?.quantity) q.set("quantity", String(params.quantity));
    if (params?.unit) q.set("unit", params.unit);
    const qs = q.toString();
    return apiRequest<any>(`/api/warehouses/${warehouseId}/availability${qs ? `?${qs}` : ""}`);
  },

  async suitabilityAnalysis(warehouseId: string, params: { cropId: string; quantity?: number; unit?: string; durationDays?: number }) {
    const q = new URLSearchParams();
    q.set("cropId", params.cropId);
    if (params.quantity) q.set("quantity", String(params.quantity));
    if (params.unit) q.set("unit", params.unit);
    if (params.durationDays) q.set("durationDays", String(params.durationDays));
    return apiRequest<any>(`/api/warehouses/${warehouseId}/suitability-analysis?${q.toString()}`);
  },
};
