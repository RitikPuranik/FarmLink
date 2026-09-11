import {
  ACCEPTABLE_FROM_STATUSES,
  canTransitionQuote,
  isQuoteConsiderable,
  isTerminalQuoteStatus,
  TERMINAL_QUOTE_STATUSES,
} from "../../src/modules/logistics/logistics-quote-state-machine";

describe("logistics quote state machine", () => {
  it("allows DRAFT -> SUBMITTED", () => {
    expect(canTransitionQuote("DRAFT", "SUBMITTED")).toBe(true);
  });

  it("allows SUBMITTED -> WITHDRAWN, EXPIRED, ACCEPTED, REJECTED", () => {
    expect(canTransitionQuote("SUBMITTED", "WITHDRAWN")).toBe(true);
    expect(canTransitionQuote("SUBMITTED", "EXPIRED")).toBe(true);
    expect(canTransitionQuote("SUBMITTED", "ACCEPTED")).toBe(true);
    expect(canTransitionQuote("SUBMITTED", "REJECTED")).toBe(true);
  });

  it("never allows a transition out of a terminal state", () => {
    for (const terminal of TERMINAL_QUOTE_STATUSES) {
      expect(canTransitionQuote(terminal, "SUBMITTED")).toBe(false);
      expect(canTransitionQuote(terminal, "ACCEPTED")).toBe(false);
      expect(canTransitionQuote(terminal, "DRAFT")).toBe(false);
    }
  });

  it("rejected quote can never be accepted later", () => {
    expect(canTransitionQuote("REJECTED", "ACCEPTED")).toBe(false);
  });

  it("expired quote can never be accepted", () => {
    expect(canTransitionQuote("EXPIRED", "ACCEPTED")).toBe(false);
  });

  it("accepted quote is immutable (no transitions out of ACCEPTED)", () => {
    expect(isTerminalQuoteStatus("ACCEPTED")).toBe(true);
    expect(canTransitionQuote("ACCEPTED", "REJECTED")).toBe(false);
    expect(canTransitionQuote("ACCEPTED", "WITHDRAWN")).toBe(false);
  });

  it("only SUBMITTED is ever an acceptable from-status for acceptance", () => {
    expect(ACCEPTABLE_FROM_STATUSES).toEqual(["SUBMITTED"]);
  });

  describe("isQuoteConsiderable", () => {
    const now = new Date("2026-01-01T00:00:00Z");

    it("is true for a SUBMITTED quote with no expiry", () => {
      expect(isQuoteConsiderable("SUBMITTED", null, now)).toBe(true);
    });

    it("is true for a SUBMITTED quote not yet past its validUntil", () => {
      expect(isQuoteConsiderable("SUBMITTED", new Date("2026-01-02T00:00:00Z"), now)).toBe(true);
    });

    it("is false for a SUBMITTED quote past its validUntil (expired quote can never be accepted)", () => {
      expect(isQuoteConsiderable("SUBMITTED", new Date("2025-12-31T00:00:00Z"), now)).toBe(false);
    });

    it("is false for any non-SUBMITTED status", () => {
      expect(isQuoteConsiderable("ACCEPTED", null, now)).toBe(false);
      expect(isQuoteConsiderable("REJECTED", null, now)).toBe(false);
      expect(isQuoteConsiderable("WITHDRAWN", null, now)).toBe(false);
      expect(isQuoteConsiderable("EXPIRED", null, now)).toBe(false);
      expect(isQuoteConsiderable("DRAFT", null, now)).toBe(false);
    });
  });
});
