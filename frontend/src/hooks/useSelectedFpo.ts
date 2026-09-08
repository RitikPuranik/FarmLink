"use client";

import * as React from "react";

const STORAGE_KEY = "anndataa.fpo_admin.selectedFpoId";

/**
 * The backend doesn't expose a "my FPO" lookup for FPO_ADMIN accounts, so
 * the admin picks their FPO once (via search) and it's remembered locally
 * for this browser, the same way a point-of-sale app remembers the last
 * till you were on.
 */
export function useSelectedFpo() {
  const [fpoId, setFpoIdState] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setFpoIdState(window.localStorage.getItem(STORAGE_KEY));
    setReady(true);
  }, []);

  const setFpoId = React.useCallback((id: string | null) => {
    setFpoIdState(id);
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { fpoId, setFpoId, ready };
}
