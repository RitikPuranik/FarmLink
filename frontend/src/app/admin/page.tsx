"use client";

import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { NotEnabledPlaceholder } from "@/components/NotEnabledPlaceholder";

export default function AdminPage() {
  return (
    <RoleProtectedPage role="ADMIN">
      <NotEnabledPlaceholder />
    </RoleProtectedPage>
  );
}
