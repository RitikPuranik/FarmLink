"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { farmerApi } from "@/services/farmerApi";
import { farmApi } from "@/services/farmApi";
import { cropApi } from "@/services/cropApi";
import {
  AddFarmerCropInput,
  CreateFarmInput,
  FarmerProfileInput,
  UpdateFarmInput,
  UpdateFarmerCropInput,
} from "@/types/farmer";

// GET /api/farmers/me already returns the full aggregate (profile + farms +
// crops + completion) in one call, so every mutation below invalidates this
// single key rather than maintaining separate farms/crops caches that could
// drift out of sync with the server-computed completion percentage.
export const FARMER_ME_QUERY_KEY = ["farmer", "me"];

export function useFarmerProfileQuery() {
  return useQuery({ queryKey: FARMER_ME_QUERY_KEY, queryFn: farmerApi.getMe, staleTime: 10_000 });
}

function useInvalidateFarmerProfile() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: FARMER_ME_QUERY_KEY });
}

export function useCreateFarmerProfile() {
  const invalidate = useInvalidateFarmerProfile();
  return useMutation({
    mutationFn: (input: FarmerProfileInput) => farmerApi.createProfile(input),
    onSuccess: invalidate,
  });
}

export function useUpdateFarmerProfile() {
  const invalidate = useInvalidateFarmerProfile();
  return useMutation({
    mutationFn: (input: FarmerProfileInput) => farmerApi.updateProfile(input),
    onSuccess: invalidate,
  });
}

export function useCreateFarm() {
  const invalidate = useInvalidateFarmerProfile();
  return useMutation({
    mutationFn: (input: CreateFarmInput) => farmApi.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdateFarm() {
  const invalidate = useInvalidateFarmerProfile();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateFarmInput }) => farmApi.update(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteFarm() {
  const invalidate = useInvalidateFarmerProfile();
  return useMutation({
    mutationFn: (id: string) => farmApi.remove(id),
    onSuccess: invalidate,
  });
}

export function useAddFarmerCrop() {
  const invalidate = useInvalidateFarmerProfile();
  return useMutation({
    mutationFn: (input: AddFarmerCropInput) => cropApi.add(input),
    onSuccess: invalidate,
  });
}

export function useUpdateFarmerCrop() {
  const invalidate = useInvalidateFarmerProfile();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateFarmerCropInput }) => cropApi.update(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteFarmerCrop() {
  const invalidate = useInvalidateFarmerProfile();
  return useMutation({
    mutationFn: (id: string) => cropApi.remove(id),
    onSuccess: invalidate,
  });
}
