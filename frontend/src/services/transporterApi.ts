import { apiRequest } from "@/lib/apiClient";

export const transporterApi = {
  async createProfile(input: Record<string, unknown>) { return apiRequest<any>("/api/transporter-profiles", { method: "POST", body: input }); },
  async me() { return apiRequest<any>("/api/transporter-profiles/me"); },
  async updateProfile(input: Record<string, unknown>) { return apiRequest<any>("/api/transporter-profiles/me", { method: "PATCH", body: input }); },
  async serviceAreas() { return apiRequest<any>("/api/transporter-profiles/me/service-areas"); },
  async addServiceArea(input: Record<string, unknown>) { return apiRequest<any>("/api/transporter-profiles/me/service-areas", { method: "POST", body: input }); },
  async removeServiceArea(id: string) { return apiRequest<any>(`/api/transporter-profiles/me/service-areas/${id}`, { method: "DELETE" }); },
  async discover(params?: Record<string, string | number | boolean>) {
    const q = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([k,v]) => { if (v !== undefined && v !== "") q.set(k, String(v)); });
    const qs=q.toString();
    return apiRequest<any>(`/api/transporters${qs ? `?${qs}` : ""}`);
  },
  async byPublicId(id: string) { return apiRequest<any>(`/api/transporters/${id}`); },
};

export const vehicleApi = {
  async list(params?: { page?: number; limit?: number }) {
    const q=new URLSearchParams(); if(params?.page) q.set("page",String(params.page)); if(params?.limit) q.set("limit",String(params.limit));
    return apiRequest<any>(`/api/vehicles?${q.toString()}`);
  },
  async register(input: Record<string, unknown>) { return apiRequest<any>("/api/vehicles", { method: "POST", body: input }); },
  async registerBulk(vehicles: Record<string, unknown>[]) { return apiRequest<any>("/api/vehicles/bulk", { method: "POST", body: { vehicles } }); },
  async get(id: string) { return apiRequest<any>(`/api/vehicles/${id}`); },
  async update(id: string, input: Record<string, unknown>) { return apiRequest<any>(`/api/vehicles/${id}`, { method: "PATCH", body: input }); },
  async availability(id: string, availabilityStatus: "AVAILABLE" | "UNAVAILABLE") { return apiRequest<any>(`/api/vehicles/${id}/availability`, { method: "PATCH", body: { availabilityStatus } }); },
  async status(id: string, status: string) { return apiRequest<any>(`/api/vehicles/${id}/status`, { method: "PATCH", body: { status } }); },
};

export const transporterAdminApi = {
  async verifyTransporter(id: string, status: string) { return apiRequest<any>(`/api/admin/transporters/${id}/verification`, { method: "PATCH", body: { status } }); },
  async verifyVehicle(id: string, status: string) { return apiRequest<any>(`/api/admin/vehicles/${id}/verification`, { method: "PATCH", body: { status } }); },
};
