import { apiRequest } from "@/lib/apiClient";

export const marketApi = {
  async snapshot(cropId: string, params?: { mandiId?: string; latitude?: number; longitude?: number }) {
    const q = new URLSearchParams();
    if (params?.mandiId) q.set("mandiId", params.mandiId);
    if (params?.latitude != null) q.set("latitude", String(params.latitude));
    if (params?.longitude != null) q.set("longitude", String(params.longitude));
    const qs = q.toString();
    return apiRequest<any>(`/api/market-intelligence/crops/${cropId}/snapshot${qs ? `?${qs}` : ""}`);
  },

  async trends(cropId: string, params?: { days?: number; mandiId?: string }) {
    const q = new URLSearchParams();
    if (params?.days) q.set("days", String(params.days));
    if (params?.mandiId) q.set("mandiId", params.mandiId);
    const qs = q.toString();
    return apiRequest<any>(`/api/market-intelligence/crops/${cropId}/trends${qs ? `?${qs}` : ""}`);
  },

  async compare(cropId: string) {
    return apiRequest<any>(`/api/market-intelligence/crops/${cropId}/compare`);
  },

  async nearby(params: { latitude: number; longitude: number; radiusKm?: number; cropId?: string }) {
    const q = new URLSearchParams();
    q.set("latitude", String(params.latitude));
    q.set("longitude", String(params.longitude));
    if (params.radiusKm) q.set("radiusKm", String(params.radiusKm));
    if (params.cropId) q.set("cropId", params.cropId);
    return apiRequest<any>(`/api/market-intelligence/nearby?${q.toString()}`);
  },

  async recommendMarket(body: { cropId: string; latitude?: number; longitude?: number; radiusKm?: number }) {
    return apiRequest<any>("/api/market-intelligence/recommend-market", { method: "POST", body });
  },

  async mandiOverview(mandiId: string) {
    return apiRequest<any>(`/api/market-intelligence/mandis/${mandiId}/overview`);
  },

  async mandiCrop(mandiId: string, cropId: string) {
    return apiRequest<any>(`/api/market-intelligence/mandis/${mandiId}/crops/${cropId}`);
  },

  async recommendForLot(lotPublicId: string, radiusKm?: number) {
    const qs = radiusKm ? `?radiusKm=${radiusKm}` : "";
    return apiRequest<any>(`/api/market-intelligence/lots/${lotPublicId}/recommend-market${qs}`, { method: "POST" });
  },
};

export const forecastApi = {
  // Module 7 (price forecasting) ships in this codebase but is not yet
  // wired into the running server — this call is here so the UI is ready
  // the moment it's mounted, and fails gracefully (visible "not available
  // yet" state) until then rather than being left out entirely.
  async latestForCrop(cropId: string) {
    return apiRequest<any>(`/api/price-forecasting/crops/${cropId}/latest`);
  },
};
