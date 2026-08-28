"use client";

import { RoleProtectedPage } from "@/components/RoleProtectedPage";
import { NotEnabledPlaceholder } from "@/components/NotEnabledPlaceholder";

export default function TransporterPage() {
  return (
    <RoleProtectedPage role="TRANSPORTER">
      <NotEnabledPlaceholder />
    </RoleProtectedPage>
  );
}
