import { apiRequest } from "@/lib/apiClient";
import { FpoMember, FpoSummary } from "@/types/domain";

function unwrapList<T>(data: any, key: string): T[] {
  if (Array.isArray(data)) return data;
  if (data?.[key]) return data[key];
  if (data?.items) return data.items;
  return [];
}

export const fpoApi = {
  async search(params?: { name?: string; districtId?: string }) {
    const q = new URLSearchParams();
    if (params?.name) q.set("name", params.name);
    if (params?.districtId) q.set("districtId", params.districtId);
    const qs = q.toString();
    const data = await apiRequest<any>(`/api/fpos${qs ? `?${qs}` : ""}`);
    return unwrapList<FpoSummary>(data, "fpos");
  },

  async details(fpoId: string) {
    const data = await apiRequest<any>(`/api/fpos/${fpoId}`);
    return (data?.fpo ?? data) as FpoSummary;
  },

  async members(fpoId: string, status?: string) {
    const qs = status ? `?status=${status}` : "";
    const data = await apiRequest<any>(`/api/fpos/${fpoId}/members${qs}`);
    return unwrapList<FpoMember>(data, "members");
  },

  async requestMembership(fpoId: string) {
    return apiRequest<any>(`/api/fpos/${fpoId}/membership-requests`, { method: "POST" });
  },

  async cropAggregation(fpoId: string) {
    return apiRequest<any>(`/api/fpos/${fpoId}/crop-aggregation`);
  },

  async analyticsOverview(fpoId: string) {
    return apiRequest<any>(`/api/fpos/${fpoId}/analytics/overview`);
  },
  async aggregationMembers(fpoId: string, cropId: string) {
    return apiRequest<any>(`/api/fpos/${fpoId}/crop-aggregation/${cropId}/members`);
  },
  async listAggregationGroups(fpoId: string, params?: { cropId?: string; status?: string }) {
    const q = new URLSearchParams();
    if (params?.cropId) q.set("cropId", params.cropId);
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return apiRequest<any>(`/api/fpos/${fpoId}/aggregation-groups${qs ? `?${qs}` : ""}`);
  },
  async createAggregationGroup(fpoId: string, input: { cropId: string; targetQuantity?: number; unit: "KG" | "QTL" | "TONNE"; targetDate?: string }) {
    return apiRequest<any>(`/api/fpos/${fpoId}/aggregation-groups`, { method: "POST", body: input });
  },
  async updateAggregationGroup(fpoId: string, aggregationId: string, input: Record<string, unknown>) {
    return apiRequest<any>(`/api/fpos/${fpoId}/aggregation-groups/${aggregationId}`, { method: "PATCH", body: input });
  },
  async cancelAggregationGroup(fpoId: string, aggregationId: string) {
    return apiRequest<any>(`/api/fpos/${fpoId}/aggregation-groups/${aggregationId}/cancel`, { method: "POST" });
  },
};

export const membershipApi = {
  async myFpo() {
    return apiRequest<any>("/api/farmers/me/fpo");
  },

  async approve(membershipId: string) {
    return apiRequest<any>(`/api/fpo-memberships/${membershipId}/approve`, { method: "POST" });
  },

  async reject(membershipId: string, reason?: string) {
    return apiRequest<any>(`/api/fpo-memberships/${membershipId}/reject`, { method: "POST", body: reason ? { reason } : undefined });
  },

  async remove(membershipId: string) {
    return apiRequest<any>(`/api/fpo-memberships/${membershipId}/remove`, { method: "POST" });
  },

  async suspend(membershipId: string) {
    return apiRequest<any>(`/api/fpo-memberships/${membershipId}/suspend`, { method: "POST" });
  },

  async reactivate(membershipId: string) {
    return apiRequest<any>(`/api/fpo-memberships/${membershipId}/reactivate`, { method: "POST" });
  },
};
