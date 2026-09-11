/**
 * Step 10 — Provider Reliability. The build spec requires inspecting
 * whether Module 15 (or any other existing module) already tracks
 * completed/cancelled/delayed trips or ratings before inventing a score.
 * It does not: `TransporterProfile`/`Vehicle` carry no trip-outcome or
 * rating fields, and `VehicleAvailabilityStatus.IN_TRANSIT` is explicitly
 * documented in schema.prisma as reserved for a *future* module to set,
 * never populated by anything that exists today. So this service always
 * returns the documented neutral default — it never fabricates a
 * reliability signal that isn't backed by real outcome data.
 *
 * Kept as its own interface/class specifically so Module 17/18/25 (once
 * they start recording actual delivery outcomes) can supply a real
 * implementation without any change to LogisticsRequestService or the
 * optimization engine that consumes it.
 */

export type ReliabilitySource = "COMPUTED" | "DEFAULT";

export interface ReliabilityScore {
  score: number;
  source: ReliabilitySource;
}

const NEUTRAL_DEFAULT_SCORE = 50;

export interface ProviderReliabilityService {
  getReliability(transportProviderId: string): Promise<ReliabilityScore>;
}

export class DefaultProviderReliabilityService implements ProviderReliabilityService {
  async getReliability(_transportProviderId: string): Promise<ReliabilityScore> {
    return { score: NEUTRAL_DEFAULT_SCORE, source: "DEFAULT" };
  }
}
