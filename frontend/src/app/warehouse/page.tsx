"use client";

import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { NotEnabledPlaceholder } from "@/components/NotEnabledPlaceholder";

export default function WarehousePage() {
  return (
    <RoleProtectedPage role="WAREHOUSE_OPERATOR">
      <NotEnabledPlaceholder />
    </RoleProtectedPage>
  );
}
