import { NetRealizationCalculation, Prisma } from "@prisma/client";
import { NotFoundError } from "../../common/errors";
import { AuditService } from "../audit/audit.service";
import { CropLotRepository } from "../lots/lots.repository";
import { NetRealizationRepository } from "./net-realization.repository";
import { NetRealizationInputResolverService } from "./net-realization-input-resolver.service";
import { NetRealizationCalculatorService } from "./net-realization-calculator.service";
import { NetRealizationRequestOverrides } from "./net-realization-input-resolver.types";
import { NetRealizationDTO, NetRealizationInput, NetRealizationMetadata } from "./net-realization.types";
import { NET_REALIZATION_ENGINE_VERSION } from "./net-realization.config";
import { trackEvent } from "../../config/posthog";
import { captureException } from "../../config/sentry";
import { convertQuantityToKg } from "../fpo/unit-conversion";

/**
 * Part I — Orchestration.
 *
 * Flow: authorize (caller's responsibility, see the controller) -> create
 * PENDING record -> resolve inputs -> run the pure engine -> persist
 * immutable snapshot + metadata -> mark COMPLETED or INSUFFICIENT_DATA ->
 * return DTO. Mirrors SellStoreOrchestrationService's own structure and
 * failure handling almost exactly, since Module 8 is this module's
 * closest architectural precedent in the codebase.
 */
export class NetRealizationOrchestrationService {
  constructor(
    private readonly lots: CropLotRepository,
    private readonly repository: NetRealizationRepository,
    private readonly resolver: NetRealizationInputResolverService,
    private readonly engine: NetRealizationCalculatorService,
    private readonly auditService?: AuditService,
  ) {}

  async calculate(
    lotPublicId: string,
    overrides: NetRealizationRequestOverrides,
    requestingUser: { id: string; role: string },
  ): Promise<NetRealizationDTO> {
    const lot = await this.lots.findByPublicId(lotPublicId);
    if (!lot) throw new NotFoundError("Lot not found.");

    const pending = await this.repository.createPendingCalculation(lot.id, lot.cropId, requestingUser.id);
    await this.recordAuditSafely(pending, requestingUser.id, lot.publicId, "NET_REALIZATION_CALCULATION_CREATED");
    trackEvent("net_realization_requested", requestingUser.id, { lotPublicId });

    try {
      const resolved = await this.resolver.resolve(lotPublicId, overrides, requestingUser);
      const engineResult = this.engine.evaluate(resolved.input);

      const metadata: NetRealizationMetadata = {
        calculationVersion: NET_REALIZATION_ENGINE_VERSION,
        includedComponents: engineResult.includedComponents,
        omittedComponents: engineResult.omittedComponents,
        explanation: engineResult.explanation,
      };

      let persisted: NetRealizationCalculation;
      if (engineResult.completeness === "INSUFFICIENT") {
        persisted = await this.repository.markInsufficient(
          pending.id,
          resolved.input.sale.source.type,
          resolved.input,
          metadata as unknown as Prisma.InputJsonValue,
        );
      } else {
        const { quantity, quantityUnit } = resolved.input.sale;
        const saleQuantityKg =
          quantity !== null && quantityUnit !== null ? convertQuantityToKg(quantity, quantityUnit) : null;

        persisted = await this.repository.completeCalculation(pending.id, {
          currency: "INR",
          priceSourceOfferId: resolved.input.sale.source.referenceId,
          priceSourceType: resolved.input.sale.source.type,
          salePricePerUnit: resolved.input.sale.pricePerUnit,
          saleQuantityKg,
          grossRevenue: engineResult.grossRevenue,
          totalKnownCosts: engineResult.totalKnownCosts,
          totalEstimatedCosts: engineResult.totalEstimatedCosts,
          totalUserProvidedCosts: engineResult.totalUserProvidedCosts,
          totalDeductions: engineResult.totalDeductions,
          netRealization: engineResult.netRealization,
          completeness: engineResult.completeness,
          dataCompletenessScore: engineResult.dataCompletenessScore,
          inputSnapshot: resolved.input,
          calculationMetadata: metadata as unknown as Prisma.InputJsonValue,
        });
      }

      const completedAction =
        persisted.status === "INSUFFICIENT_DATA"
          ? "NET_REALIZATION_CALCULATION_INSUFFICIENT_DATA"
          : "NET_REALIZATION_CALCULATION_COMPLETED";
      await this.recordAuditSafely(persisted, requestingUser.id, lot.publicId, completedAction);
      trackEvent(
        persisted.status === "INSUFFICIENT_DATA" ? "net_realization_insufficient_data" : "net_realization_completed",
        requestingUser.id,
        { lotPublicId, completeness: engineResult.completeness },
      );

      return this.mapToDTO(persisted, resolved.input, metadata);
    } catch (error) {
      const failed = await this.repository.failCalculation(pending.id);
      await this.recordAuditSafely(failed, requestingUser.id, lot.publicId, "NET_REALIZATION_CALCULATION_FAILED");
      trackEvent("net_realization_failed", requestingUser.id, { lotPublicId });
      captureException(error, {
        operation: "net_realization_calculation",
        lotPublicId,
        calculationVersion: NET_REALIZATION_ENGINE_VERSION,
      });
      throw error;
    }
  }

  async getByPublicId(publicId: string): Promise<NetRealizationDTO> {
    const calculation = await this.repository.findByPublicId(publicId);
    if (!calculation) throw new NotFoundError("Calculation not found.");
    return this.mapToDTO(calculation);
  }

  async listForLot(lotPublicId: string, page: number, pageSize: number) {
    const lot = await this.lots.findByPublicId(lotPublicId);
    if (!lot) throw new NotFoundError("Lot not found.");

    const result = await this.repository.listByLotIdPaginated(lot.id, page, pageSize);
    return {
      items: result.items.map((c) => this.mapToDTO(c)),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  private async recordAuditSafely(
    calculation: NetRealizationCalculation,
    requestedByUserId: string | null,
    lotPublicId: string,
    action:
      | "NET_REALIZATION_CALCULATION_CREATED"
      | "NET_REALIZATION_CALCULATION_COMPLETED"
      | "NET_REALIZATION_CALCULATION_INSUFFICIENT_DATA"
      | "NET_REALIZATION_CALCULATION_FAILED",
  ): Promise<void> {
    if (!this.auditService) return;
    try {
      await this.auditService.record({
        actorUserId: requestedByUserId,
        action,
        entityType: "NetRealizationCalculation",
        entityId: calculation.publicId,
        metadata: { lotPublicId, status: calculation.status },
      });
    } catch (err) {
      captureException(err instanceof Error ? err : new Error("Net realization audit logging failed"), {
        lotPublicId,
        calculationPublicId: calculation.publicId,
      });
    }
  }

  private mapToDTO(
    calculation: NetRealizationCalculation,
    inputOverride?: NetRealizationInput,
    metadataOverride?: NetRealizationMetadata,
  ): NetRealizationDTO {
    const inputSnapshot = inputOverride ?? (calculation.inputSnapshot as unknown as NetRealizationInput | null);
    const metadata =
      metadataOverride ?? (calculation.calculationMetadata as unknown as NetRealizationMetadata | null);

    return {
      publicId: calculation.publicId,
      lotId: calculation.lotId,
      lotPublicId: inputSnapshot?.lot.lotPublicId ?? "",
      status: calculation.status,
      currency: calculation.currency,
      sale: {
        pricePerUnit: calculation.salePricePerUnit !== null ? Number(calculation.salePricePerUnit) : null,
        priceUnit: inputSnapshot?.sale.priceUnit ?? null,
        quantity: inputSnapshot?.sale.quantity ?? null,
        quantityUnit: inputSnapshot?.sale.quantityUnit ?? null,
        grossRevenue: calculation.grossRevenue !== null ? Number(calculation.grossRevenue) : null,
        source: inputSnapshot?.sale.source ?? {
          type: calculation.priceSourceType ?? "UNAVAILABLE",
          referenceId: calculation.priceSourceOfferId,
          valueSource: "UNKNOWN",
        },
      },
      costs: {
        included: (metadata?.includedComponents ?? []).map((c) => ({
          category: c.category,
          name: c.name,
          amount: c.amount,
          source: c.source,
        })),
        unavailable: metadata?.omittedComponents ?? [],
        totals: {
          known: calculation.totalKnownCosts !== null ? Number(calculation.totalKnownCosts) : null,
          estimated: calculation.totalEstimatedCosts !== null ? Number(calculation.totalEstimatedCosts) : null,
          userProvided:
            calculation.totalUserProvidedCosts !== null ? Number(calculation.totalUserProvidedCosts) : null,
        },
      },
      result: {
        netRealization: calculation.netRealization !== null ? Number(calculation.netRealization) : null,
        completeness: calculation.completeness,
        dataCompletenessScore:
          calculation.dataCompletenessScore !== null ? Number(calculation.dataCompletenessScore) : null,
      },
      explanation: metadata?.explanation ?? null,
      metadata: {
        calculationVersion: metadata?.calculationVersion ?? null,
        calculatedAt: calculation.updatedAt.toISOString(),
      },
      inputSnapshot,
      createdAt: calculation.createdAt,
      updatedAt: calculation.updatedAt,
    };
  }
}
