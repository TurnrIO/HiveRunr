import { useCallback, useRef, useState } from "react";

export function useResilientLoad(loader, {
  onSuccess,
  onHardError,
  getErrorMessage,
  initialLoading = true,
} = {}) {
  const [loading, setLoading] = useState(initialLoading);
  const [loadError, setLoadError] = useState("");
  const hasDataRef = useRef(false);

  const load = useCallback(async ({ silent = false, clearError = true } = {}) => {
    if (!silent || !hasDataRef.current) {
      setLoading(true);
    }
    if (!silent && clearError) {
      setLoadError("");
    }
    try {
      const data = await loader();
      hasDataRef.current = true;
      setLoadError("");
      onSuccess?.(data);
      return data;
    } catch (err) {
      if (silent && hasDataRef.current) {
        return null;
      }
      hasDataRef.current = false;
      const message = getErrorMessage?.(err) || err?.message || "Request failed";
      setLoadError(message);
      onHardError?.(err, { silent, message });
      return null;
    } finally {
      if (!silent || !hasDataRef.current) {
        setLoading(false);
      }
    }
  }, [getErrorMessage, loader, onHardError, onSuccess]);

  return {
    hasDataRef,
    load,
    loadError,
    loading,
    setLoadError,
    setLoading,
  };
}
