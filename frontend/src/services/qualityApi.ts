import { apiRequest } from "@/lib/apiClient";
import { CreateAssessmentInput, QualityAssessment } from "@/types/domain";

function unwrapList<T>(data: any, key: string): T[] {
  if (Array.isArray(data)) return data;
  if (data?.[key]) return data[key];
  if (data?.items) return data.items;
  return [];
}

export const qualityApi = {
  async listForLot(lotPublicId: string) {
    const data = await apiRequest<any>(`/api/lots/${lotPublicId}/quality-assessments`);
    return unwrapList<QualityAssessment>(data, "assessments");
  },

  async summaryForLot(lotPublicId: string) {
    return apiRequest<any>(`/api/lots/${lotPublicId}/quality-summary`);
  },

  async create(lotPublicId: string, input: CreateAssessmentInput) {
    const data = await apiRequest<any>(`/api/lots/${lotPublicId}/quality-assessments`, {
      method: "POST",
      body: input,
    });
    return (data?.assessment ?? data) as QualityAssessment;
  },

  async get(publicId: string) {
    const data = await apiRequest<any>(`/api/quality-assessments/${publicId}`);
    return (data?.assessment ?? data) as QualityAssessment;
  },

  async analyze(publicId: string) {
    return apiRequest<any>(`/api/quality-assessments/${publicId}/analyze`, { method: "POST" });
  },

  async retryAnalyze(publicId: string) {
    return apiRequest<any>(`/api/quality-assessments/${publicId}/analyze/retry`, { method: "POST" });
  },

  async farmerSummary() {
    return apiRequest<any>("/api/farmers/me/quality-summary");
  },
};
