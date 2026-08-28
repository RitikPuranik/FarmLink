"use client";

import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { NotEnabledPlaceholder } from "@/components/NotEnabledPlaceholder";

export default function GovernmentPage() {
  return (
    <RoleProtectedPage role="GOVERNMENT_VIEWER">
      <NotEnabledPlaceholder />
    </RoleProtectedPage>
  );
}
