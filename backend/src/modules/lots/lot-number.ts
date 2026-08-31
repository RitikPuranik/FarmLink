/**
 * Human-facing lot reference generation (build spec section 10):
 * "LOT-2026-000123" — unique, server-generated, never accepted as
 * authoritative from the client, stable after creation. The lot's real API
 * identity is still `publicId` (build spec section 48); this is only for
 * display/QR/warehouse-slip purposes.
 *
 * Sequence numbers reset per calendar year and are derived from how many
 * lots already exist for that year (CropLotRepository.countForYear) —
 * simple and readable, at the cost of needing a retry on the rare race
 * where two lots are created in the same instant (see
 * lots.repository.ts' create(), which retries this exact way).
 */

const SEQUENCE_WIDTH = 6;

export function buildLotNumber(year: number, sequence: number): string {
  return `LOT-${year}-${String(sequence).padStart(SEQUENCE_WIDTH, "0")}`;
}

/** Small bump applied on unique-constraint retries so two concurrent
 * creations in the same year don't loop on the exact same candidate
 * number forever (build spec section 10: still deterministic-looking,
 * still unique). */
export function nextLotNumberCandidate(year: number, baseSequence: number, attempt: number): string {
  return buildLotNumber(year, baseSequence + attempt);
}
