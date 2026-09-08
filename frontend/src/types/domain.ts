// Shared, intentionally permissive types for the newer feature modules
// (lots, quality, market intelligence, sell-vs-store, warehouse
// intelligence, buyer matching / trade offers, net realization, FPO admin).
// Fields that come from deterministic analytics engines carry many
// optional/nested fields that vary by scenario (INSUFFICIENT_DATA vs a
// full result) — those are typed loosely (`Record<string, unknown>` /
// optional) on purpose so the UI renders gracefully however the backend
// shapes a given response, rather than crashing on a missing field.

export type QuantityUnit = "KG" | "QTL" | "TONNE";
export type Grade = "A" | "B" | "C" | "D" | "REJECTED";

export type LotStatus =
  | "DRAFT"
  | "AVAILABLE"
  | "PARTIALLY_COMMITTED"
  | "COMMITTED"
  | "STORED"
  | "IN_TRANSACTION"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED";

export interface CropLot {
  id: string;
  publicId?: string;
  status: LotStatus;
  quantity: number;
  unit: QuantityUnit;
  variety?: string | null;
  harvestDate?: string | null;
  availabilityDate: string;
  createdAt: string;
  updatedAt?: string;
  farmId?: string | null;
  fpoId?: string | null;
  crop: {
    id: string;
    name: string;
    category?: string | null;
    translations?: Partial<Record<"en" | "hi" | "mr", string>>;
  };
  [key: string]: unknown;
}

export interface CreateLotInput {
  farmId?: string;
  fpoId?: string;
  cropId: string;
  quantity: number;
  unit: QuantityUnit;
  variety?: string;
  harvestDate?: string;
  availabilityDate: string;
}

export interface LotHistoryEntry {
  id?: string;
  fromStatus?: LotStatus | null;
  toStatus: LotStatus;
  createdAt: string;
  note?: string | null;
  [key: string]: unknown;
}

export interface LotSummary {
  totalLots?: number;
  byStatus?: Record<string, number>;
  totalQuantityKg?: number;
  [key: string]: unknown;
}

// ---- Quality -------------------------------------------------------------

export type AssessmentSource = "MANUAL" | "AI" | "LAB" | "HYBRID";

export interface QualityMetric {
  code?: string;
  name: string;
  value: number;
  unit?: string;
}

export interface QualityAssessment {
  id?: string;
  publicId: string;
  lotId?: string;
  source: AssessmentSource;
  overallGrade?: Grade | null;
  confidence?: number | null;
  status?: string;
  metrics?: QualityMetric[];
  notes?: string | null;
  createdAt: string;
  [key: string]: unknown;
}

export interface CreateAssessmentInput {
  source: AssessmentSource;
  metrics?: QualityMetric[];
  overallGrade?: Grade;
  notes?: string;
}

// ---- Market intelligence ---------------------------------------------------

export type FreshnessState = "FRESH" | "RECENT" | "STALE" | "OUTDATED";

export interface MarketSnapshot {
  cropId?: string;
  freshness?: FreshnessState;
  modalPrice?: number;
  minPrice?: number;
  maxPrice?: number;
  unit?: string;
  mandiName?: string;
  asOfDate?: string;
  [key: string]: unknown;
}

export interface MandiOption {
  id: string;
  name: string;
  distanceKm?: number;
  [key: string]: unknown;
}

// ---- Warehouse intelligence -------------------------------------------------

export interface Warehouse {
  id: string;
  name: string;
  storageType?: string;
  distanceKm?: number;
  [key: string]: unknown;
}

export interface WarehouseRecommendation {
  warehouse?: Warehouse;
  score?: number;
  distanceKm?: number;
  [key: string]: unknown;
}

// ---- Buyer matching / trade offers ------------------------------------------

export type BusinessType = "PROCESSOR" | "WHOLESALER" | "RETAILER" | "EXPORTER" | "INSTITUTIONAL_BUYER" | "TRADER" | "OTHER";
export type BuyerVerificationStatus = "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";

export interface BuyerProfile {
  publicId?: string;
  organizationName: string;
  businessType: BusinessType;
  description?: string | null;
  contactPerson: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  state: string;
  district: string;
  latitude?: number | null;
  longitude?: number | null;
  website?: string | null;
  verificationStatus?: BuyerVerificationStatus;
  createdAt?: string;
  [key: string]: unknown;
}

export type DemandStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "FULFILLED" | "EXPIRED" | "CANCELLED";

export interface BuyerDemand {
  publicId: string;
  cropId: string;
  cropName?: string;
  title: string;
  description?: string | null;
  requiredQuantity: number;
  minimumQuantity?: number | null;
  quantityUnit: QuantityUnit;
  targetPrice?: number | null;
  minimumPrice?: number | null;
  maximumPrice?: number | null;
  grade?: Grade | null;
  state: string;
  district: string;
  status: DemandStatus;
  createdAt: string;
  expiresAt?: string | null;
  [key: string]: unknown;
}

export interface CreateDemandInput {
  cropId: string;
  title: string;
  description?: string;
  requiredQuantity: number;
  minimumQuantity?: number;
  quantityUnit: QuantityUnit;
  targetPrice?: number;
  minimumPrice?: number;
  maximumPrice?: number;
  grade?: Grade;
  state: string;
  district: string;
  deliveryLocation?: string;
}

export interface BuyerMatch {
  buyer?: BuyerProfile;
  demand?: BuyerDemand;
  score?: number;
  matchedOn?: string[];
  [key: string]: unknown;
}

export type TradeOfferStatus = "PENDING" | "COUNTERED" | "ACCEPTED" | "REJECTED" | "WITHDRAWN" | "EXPIRED";

export interface TradeOffer {
  publicId: string;
  lotPublicId?: string;
  buyerDemandPublicId?: string | null;
  quantity: number;
  quantityUnit: QuantityUnit;
  offeredPrice: number;
  deliveryTerms?: string | null;
  message?: string | null;
  status: TradeOfferStatus;
  createdAt: string;
  expiresAt?: string | null;
  initiatorRole?: string;
  [key: string]: unknown;
}

export interface CreateOfferInput {
  lotPublicId: string;
  buyerDemandPublicId?: string;
  quantity: number;
  quantityUnit: QuantityUnit;
  offeredPrice: number;
  deliveryTerms?: string;
  message?: string;
}

export interface CounterOfferInput {
  quantity: number;
  quantityUnit: QuantityUnit;
  offeredPrice: number;
  deliveryTerms?: string;
  message?: string;
}

// ---- FPO admin ---------------------------------------------------------------

export type FpoVerificationStatus = "PENDING" | "UNDER_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED" | "EXPIRED";
export type MembershipStatus = "PENDING" | "ACTIVE" | "REJECTED" | "SUSPENDED" | "REMOVED";

export interface FpoSummary {
  id: string;
  name: string;
  organizationType?: string;
  verificationStatus?: FpoVerificationStatus;
  district?: { id: string; name: string } | string | null;
  memberCount?: number;
  [key: string]: unknown;
}

export interface FpoMember {
  membershipId: string;
  status: MembershipStatus;
  farmer?: { fullName?: string; mobile?: string };
  createdAt?: string;
  [key: string]: unknown;
}
