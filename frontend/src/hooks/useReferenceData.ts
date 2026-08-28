"use client";

import { useQuery } from "@tanstack/react-query";
import { referenceApi } from "@/services/referenceApi";

// Reference data changes rarely (a new state/crop is an admin action, not a
// farmer action), so it's cached aggressively — no reason to refetch it on
// every window focus like the farmer's own live data.
const STATIC_STALE_TIME = 5 * 60_000;

export function useLanguagesQuery() {
  return useQuery({ queryKey: ["reference", "languages"], queryFn: referenceApi.languages, staleTime: STATIC_STALE_TIME });
}

export function useIrrigationTypesQuery() {
  return useQuery({
    queryKey: ["reference", "irrigationTypes"],
    queryFn: referenceApi.irrigationTypes,
    staleTime: STATIC_STALE_TIME,
  });
}

export function useStatesQuery() {
  return useQuery({ queryKey: ["reference", "states"], queryFn: referenceApi.states, staleTime: STATIC_STALE_TIME });
}

export function useDistrictsQuery(stateId: string | undefined) {
  return useQuery({
    queryKey: ["reference", "districts", stateId],
    queryFn: () => referenceApi.districts(stateId!),
    enabled: !!stateId,
    staleTime: STATIC_STALE_TIME,
  });
}

export function useTalukasQuery(districtId: string | undefined) {
  return useQuery({
    queryKey: ["reference", "talukas", districtId],
    queryFn: () => referenceApi.talukas(districtId!),
    enabled: !!districtId,
    staleTime: STATIC_STALE_TIME,
  });
}

export function useCropsQuery() {
  return useQuery({ queryKey: ["reference", "crops"], queryFn: referenceApi.crops, staleTime: STATIC_STALE_TIME });
}

export function useFposQuery(districtId: string | undefined) {
  return useQuery({
    queryKey: ["reference", "fpos", districtId ?? "all"],
    queryFn: () => referenceApi.fpos(districtId),
    staleTime: STATIC_STALE_TIME,
  });
}
