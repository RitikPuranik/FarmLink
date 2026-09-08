import { apiRequest } from "@/lib/apiClient";

function unwrapList<T>(data: any, key: string): T[] {
  if (Array.isArray(data)) return data;
  if (data?.[key]) return data[key];
  if (data?.items) return data.items;
  return [];
}

export interface CalculateRealizationInput {
  offerPublicId?: string;
  salePricePerUnit?: number;
  salePriceUnit?: "KG" | "QTL" | "TONNE";
  saleQuantity?: number;
  saleQuantityUnit?: "KG" | "QTL" | "TONNE";
  costs?: { category: string; amount: number; name?: string; isIncludedInPrice?: boolean }[];
}

export const netRealizationApi = {
  async calculate(lotPublicId: string, input: CalculateRealizationInput) {
    return apiRequest<any>(`/api/net-realization/lots/${lotPublicId}/calculate`, { method: "POST", body: input });
  },

  async get(publicId: string) {
    return apiRequest<any>(`/api/net-realization/${publicId}`);
  },

  async listForLot(lotPublicId: string) {
    const data = await apiRequest<any>(`/api/lots/${lotPublicId}/net-realizations`);
    return unwrapList<any>(data, "calculations");
  },
};
