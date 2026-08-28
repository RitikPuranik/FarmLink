import { AreaUnit, IrrigationType } from "@prisma/client";
import { FarmWithLocation } from "./farms.repository";

export interface FarmDTO {
  id: string;
  name: string | null;
  village: string;
  pincode: string | null;
  // Coordinates are only ever included here — the response to the owning
  // farmer's own authenticated request. Build spec section 49: never in
  // PostHog, never in ordinary buyer-facing responses (there are none in
  // this module; future buyer/logistics modules must apply their own
  // authorization before reusing this field).
  latitude: number | null;
  longitude: number | null;
  state: { id: string; name: string };
  district: { id: string; name: string };
  taluka: { id: string; name: string };
  area: number;
  areaUnit: AreaUnit;
  irrigationType: IrrigationType;
  createdAt: string;
  updatedAt: string;
}

export function toFarmDTO(farm: FarmWithLocation): FarmDTO {
  return {
    id: farm.id,
    name: farm.name,
    village: farm.village,
    pincode: farm.pincode,
    latitude: farm.latitude,
    longitude: farm.longitude,
    state: { id: farm.state.id, name: farm.state.name },
    district: { id: farm.district.id, name: farm.district.name },
    taluka: { id: farm.taluka.id, name: farm.taluka.name },
    area: farm.area,
    areaUnit: farm.areaUnit,
    irrigationType: farm.irrigationType,
    createdAt: farm.createdAt.toISOString(),
    updatedAt: farm.updatedAt.toISOString(),
  };
}
