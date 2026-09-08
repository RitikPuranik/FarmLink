import { apiRequest } from "@/lib/apiClient";

function unwrapList<T>(data: any, key: string): T[] {
  if (Array.isArray(data)) return data;
  if (data?.[key]) return data[key];
  if (data?.items) return data.items;
  return [];
}

export const sellStoreApi = {
  async analyze(lotPublicId: string) {
    return apiRequest<any>(`/api/sell-vs-store/lots/${lotPublicId}/analyze`, { method: "POST" });
  },

  async history(lotPublicId: string) {
    const data = await apiRequest<any>(`/api/sell-vs-store/lots/${lotPublicId}/history`);
    return unwrapList<any>(data, "decisions");
  },

  async get(publicId: string) {
    return apiRequest<any>(`/api/sell-vs-store/decisions/${publicId}`);
  },
};
