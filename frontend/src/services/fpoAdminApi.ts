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
