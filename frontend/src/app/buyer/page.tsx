"use client";

import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { NotEnabledPlaceholder } from "@/components/NotEnabledPlaceholder";

export default function BuyerPage() {
  return (
    <RoleProtectedPage role="BUYER">
      <NotEnabledPlaceholder />
    </RoleProtectedPage>
  );
}
