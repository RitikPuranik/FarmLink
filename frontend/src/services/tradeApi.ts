import { apiRequest } from "@/lib/apiClient";
import {
  BuyerDemand,
  BuyerMatch,
  BuyerProfile,
  CounterOfferInput,
  CreateDemandInput,
  CreateOfferInput,
  TradeOffer,
} from "@/types/domain";

function unwrapList<T>(data: any, key: string): T[] {
  if (Array.isArray(data)) return data;
  if (data?.[key]) return data[key];
  if (data?.items) return data.items;
  return [];
}

export const buyerApi = {
  async createProfile(input: Omit<BuyerProfile, "publicId" | "verificationStatus" | "createdAt">) {
    const data = await apiRequest<any>("/api/buyers/profile", { method: "POST", body: input });
    return (data?.buyer ?? data) as BuyerProfile;
  },

  async me() {
    const data = await apiRequest<any>("/api/buyers/profile/me");
    return (data?.buyer ?? data) as BuyerProfile;
  },

  async updateProfile(input: Partial<BuyerProfile>) {
    const data = await apiRequest<any>("/api/buyers/profile/me", { method: "PATCH", body: input });
    return (data?.buyer ?? data) as BuyerProfile;
  },

  async byPublicId(publicId: string) {
    const data = await apiRequest<any>(`/api/buyers/${publicId}`);
    return (data?.buyer ?? data) as BuyerProfile;
  },

  async adminVerify(publicId: string, action: "verify" | "reject" | "suspend") {
    return apiRequest<any>(`/api/admin/buyers/${publicId}/${action}`, { method: "POST" });
  },
};

export const demandApi = {
  async create(input: CreateDemandInput) {
    const data = await apiRequest<any>("/api/buyer-demands", { method: "POST", body: input });
    return (data?.demand ?? data) as BuyerDemand;
  },

  async list() {
    const data = await apiRequest<any>("/api/buyer-demands");
    return unwrapList<BuyerDemand>(data, "demands");
  },

  async get(publicId: string) {
    const data = await apiRequest<any>(`/api/buyer-demands/${publicId}`);
    return (data?.demand ?? data) as BuyerDemand;
  },

  async update(publicId: string, input: Partial<CreateDemandInput>) {
    const data = await apiRequest<any>(`/api/buyer-demands/${publicId}`, { method: "PATCH", body: input });
    return (data?.demand ?? data) as BuyerDemand;
  },

  async transition(publicId: string, action: "activate" | "pause" | "cancel") {
    return apiRequest<any>(`/api/buyer-demands/${publicId}/${action}`, { method: "POST" });
  },
};

export const matchingApi = {
  async matchesForLot(lotPublicId: string) {
    const data = await apiRequest<any>(`/api/buyer-matching/lots/${lotPublicId}/matches`);
    return unwrapList<BuyerMatch>(data, "matches");
  },
};

export const tradeOfferApi = {
  async create(input: CreateOfferInput) {
    const data = await apiRequest<any>("/api/trade-offers", { method: "POST", body: input });
    return (data?.offer ?? data) as TradeOffer;
  },

  async list() {
    const data = await apiRequest<any>("/api/trade-offers");
    return unwrapList<TradeOffer>(data, "offers");
  },

  async get(publicId: string) {
    const data = await apiRequest<any>(`/api/trade-offers/${publicId}`);
    return (data?.offer ?? data) as TradeOffer;
  },

  async counter(publicId: string, input: CounterOfferInput) {
    const data = await apiRequest<any>(`/api/trade-offers/${publicId}/counter`, { method: "POST", body: input });
    return (data?.offer ?? data) as TradeOffer;
  },

  async accept(publicId: string) {
    const data = await apiRequest<any>(`/api/trade-offers/${publicId}/accept`, { method: "POST" });
    return (data?.offer ?? data) as TradeOffer;
  },

  async reject(publicId: string) {
    const data = await apiRequest<any>(`/api/trade-offers/${publicId}/reject`, { method: "POST" });
    return (data?.offer ?? data) as TradeOffer;
  },

  async withdraw(publicId: string) {
    const data = await apiRequest<any>(`/api/trade-offers/${publicId}/withdraw`, { method: "POST" });
    return (data?.offer ?? data) as TradeOffer;
  },

  async history(publicId: string) {
    const data = await apiRequest<any>(`/api/trade-offers/${publicId}/history`);
    return unwrapList<any>(data, "history");
  },
};
