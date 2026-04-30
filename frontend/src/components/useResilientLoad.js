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
  const onSuccessRef = useRef(onSuccess);
  const onHardErrorRef = useRef(onHardError);
  const getErrorMessageRef = useRef(getErrorMessage);

  onSuccessRef.current = onSuccess;
  onHardErrorRef.current = onHardError;
  getErrorMessageRef.current = getErrorMessage;

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
      onSuccessRef.current?.(data);
      return data;
    } catch (err) {
      if (silent && hasDataRef.current) {
        return null;
      }
      hasDataRef.current = false;
      const message = getErrorMessageRef.current?.(err) || err?.message || "Request failed";
      setLoadError(message);
      onHardErrorRef.current?.(err, { silent, message });
      return null;
    } finally {
      if (!silent || !hasDataRef.current) {
        setLoading(false);
      }
    }
  }, [loader]);

  return {
    hasDataRef,
    load,
    loadError,
    loading,
    setLoadError,
    setLoading,
  };
}
