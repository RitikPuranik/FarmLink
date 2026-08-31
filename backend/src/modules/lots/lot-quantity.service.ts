import { CropLotWithRelations } from "./lots.types";
import { CropLotRepository } from "./lots.repository";
import { ConflictError, NotFoundError } from "../../common/errors";

/**
 * Build spec section 29-31: a real reservation/order/offer workflow
 * doesn't exist yet, so `reserve`/`release`/`consume` are deliberately not
 * wired to any route — nothing in Module 4 calls them. They exist now so
 * the *shape* future modules build against is settled today: quantity
 * mutation always goes through this service (never a direct
 * `availableQuantityKg` write from a controller), and the "can never go
 * negative" guarantee is enforced atomically in
 * CropLotRepository.adjustAvailableQuantity(), not re-checked here in
 * application code where it could race.
 */
export class LotQuantityService {
  constructor(private readonly lots: CropLotRepository) {}

  async getAvailableQuantity(lotId: string): Promise<number> {
    const lot = await this.lots.findById(lotId);
    if (!lot) throw new NotFoundError("Lot not found.");
    return Number(lot.availableQuantityKg);
  }

  async reserve(lotId: string, quantityKg: number): Promise<CropLotWithRelations> {
    return this.decrement(lotId, quantityKg);
  }

  async consume(lotId: string, quantityKg: number): Promise<CropLotWithRelations> {
    return this.decrement(lotId, quantityKg);
  }

  async release(lotId: string, quantityKg: number): Promise<CropLotWithRelations> {
    const updated = await this.lots.adjustAvailableQuantity(lotId, Math.abs(quantityKg));
    if (!updated) throw new NotFoundError("Lot not found.");
    return updated;
  }

  private async decrement(lotId: string, quantityKg: number): Promise<CropLotWithRelations> {
    if (quantityKg <= 0) {
      throw new ConflictError("Quantity to reserve or consume must be greater than zero.");
    }
    const updated = await this.lots.adjustAvailableQuantity(lotId, -Math.abs(quantityKg));
    if (!updated) {
      // Either the lot doesn't exist, or the atomic guard in the
      // repository found availableQuantityKg was already below the
      // requested amount — from the caller's point of view both are
      // "you can't have this much of this lot right now".
      const stillExists = await this.lots.findById(lotId);
      if (!stillExists) throw new NotFoundError("Lot not found.");
      throw new ConflictError("The requested quantity exceeds what is currently available on this lot.");
    }
    return updated;
  }
}
