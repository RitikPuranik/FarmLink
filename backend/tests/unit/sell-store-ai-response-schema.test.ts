import { parseSellStoreAdvisoryResponse } from "../../src/modules/sell-vs-store/ai/sell-store-ai-response.schema";
import { SellStoreAIProviderError } from "../../src/modules/sell-vs-store/ai/sell-store-ai.types";

describe("parseSellStoreAdvisoryResponse", () => {
  const validResponse = {
    summary: "Available data shows a modest upward price trend with high confidence.",
    reasoning: ["Market trend is UP over the last 7 days.", "Quality grade A supports storing if desired."],
    risks: ["Storage feasibility is unknown, so this has limited confidence."],
    considerations: ["Grade A produce tends to sustain storage better than lower grades."],
    dataLimitations: ["Storage cost/duration data is not currently available."],
    advisoryAlignment: {
      agreesWithDeterministicDecision: true,
      explanation: "The upward trend and strong quality grade both support SELL_NOW being reconsidered, but align overall.",
    },
  };

  it("1. a valid response passes validation and is returned unchanged", () => {
    const result = parseSellStoreAdvisoryResponse(validResponse);
    expect(result).toEqual(validResponse);
  });

  it("2. a response missing a required field is rejected", () => {
    const { summary, ...withoutSummary } = validResponse;
    expect(() => parseSellStoreAdvisoryResponse(withoutSummary)).toThrow(SellStoreAIProviderError);
  });

  it("3. a response with the wrong field type is rejected", () => {
    const malformed = { ...validResponse, reasoning: "not an array" };
    expect(() => parseSellStoreAdvisoryResponse(malformed)).toThrow(SellStoreAIProviderError);
  });

  it("4. an oversized array is rejected", () => {
    const malformed = { ...validResponse, risks: Array.from({ length: 20 }, (_, i) => `risk ${i}`) };
    expect(() => parseSellStoreAdvisoryResponse(malformed)).toThrow(SellStoreAIProviderError);
  });

  it("5. an oversized string is rejected", () => {
    const malformed = { ...validResponse, summary: "x".repeat(5000) };
    expect(() => parseSellStoreAdvisoryResponse(malformed)).toThrow(SellStoreAIProviderError);
  });

  it("6. a response with an unexpected extra top-level field is rejected (no arbitrary JSON)", () => {
    const malformed = { ...validResponse, forecast: "prices will rise 20% next month" };
    expect(() => parseSellStoreAdvisoryResponse(malformed)).toThrow(SellStoreAIProviderError);
  });

  it("7. a response with an unexpected extra nested field is rejected", () => {
    const malformed = {
      ...validResponse,
      advisoryAlignment: { ...validResponse.advisoryAlignment, confidenceScore: 0.99 },
    };
    expect(() => parseSellStoreAdvisoryResponse(malformed)).toThrow(SellStoreAIProviderError);
  });

  it("8. completely arbitrary JSON is rejected outright", () => {
    expect(() => parseSellStoreAdvisoryResponse({ hello: "world" })).toThrow(SellStoreAIProviderError);
    expect(() => parseSellStoreAdvisoryResponse("just a string")).toThrow(SellStoreAIProviderError);
    expect(() => parseSellStoreAdvisoryResponse(null)).toThrow(SellStoreAIProviderError);
  });

  it("9. the thrown error uses the stable AI_RESPONSE_INVALID code", () => {
    try {
      parseSellStoreAdvisoryResponse({ hello: "world" });
      fail("expected parseSellStoreAdvisoryResponse to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SellStoreAIProviderError);
      expect((err as SellStoreAIProviderError).code).toBe("AI_RESPONSE_INVALID");
    }
  });
});
