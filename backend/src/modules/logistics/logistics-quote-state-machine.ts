/**
 * Step 8 — explicit LogisticsQuote state machine. Pure and side-effect
 * free: the repository layer performs the actual atomic DB transition
 * (conditional updateMany, same pattern as CropLotRepository.transition —
 * see logistics-quote.repository.ts), this file only answers "is X -> Y
 * ever a legal transition".
 */

export type LogisticsQuoteStatus = "DRAFT" | "SUBMITTED" | "EXPIRED" | "WITHDRAWN" | "ACCEPTED" | "REJECTED";

const ALLOWED_TRANSITIONS: Record<LogisticsQuoteStatus, LogisticsQuoteStatus[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["WITHDRAWN", "EXPIRED", "ACCEPTED", "REJECTED"],
  EXPIRED: [],
  WITHDRAWN: [],
  ACCEPTED: [],
  REJECTED: [],
};

/** Terminal states can never be modified or re-decided (Step 8: "Accepted
 * quote cannot be modified", "Rejected quote cannot be accepted later",
 * "Expired quote cannot be accepted"). */
export const TERMINAL_QUOTE_STATUSES: readonly LogisticsQuoteStatus[] = [
  "EXPIRED",
  "WITHDRAWN",
  "ACCEPTED",
  "REJECTED",
];

export function isTerminalQuoteStatus(status: LogisticsQuoteStatus): boolean {
  return (TERMINAL_QUOTE_STATUSES as string[]).includes(status);
}

export function canTransitionQuote(from: LogisticsQuoteStatus, to: LogisticsQuoteStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** The only statuses a quote may ever be accepted *from* — a single
 * source of truth so logistics-quote.repository.ts's atomic acceptance
 * update and this file's own canTransitionQuote() can never drift apart. */
export const ACCEPTABLE_FROM_STATUSES: readonly LogisticsQuoteStatus[] = ["SUBMITTED"];

/** A quote is still eligible to be accepted/considered only while
 * SUBMITTED and not past its own validUntil — combines the state-machine
 * check with the time-based expiry the DB row itself doesn't enforce
 * automatically (Step 8: "Expired quote cannot be accepted"). */
export function isQuoteConsiderable(status: LogisticsQuoteStatus, validUntil: Date | null, now: Date = new Date()): boolean {
  if (status !== "SUBMITTED") return false;
  if (validUntil && validUntil.getTime() < now.getTime()) return false;
  return true;
}
