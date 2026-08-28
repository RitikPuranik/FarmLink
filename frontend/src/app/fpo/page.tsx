"use client";

import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { NotEnabledPlaceholder } from "@/components/NotEnabledPlaceholder";

export default function FpoPage() {
  return (
    <RoleProtectedPage role="FPO_ADMIN">
      <NotEnabledPlaceholder />
    </RoleProtectedPage>
  );
}
