import { useCallback, useEffect, useMemo, useState } from "react";
import type { InvokeArgs, InvokeChannel, InvokeResult } from "@shared/ipc";

interface UseIpcOptions<C extends InvokeChannel> {
  autoInvoke?: boolean;
  enabled?: boolean;
  args?: InvokeArgs<C>;
  initialData?: InvokeResult<C> | null;
}

interface UseIpcResult<C extends InvokeChannel> {
  data: InvokeResult<C> | null;
  loading: boolean;
  error: string | null;
  invoke: (...params: InvokeArgs<C>) => Promise<InvokeResult<C>>;
}

/**
 * Typed invoke helper for preload IPC channels.
 * Use this from renderer hooks/components to avoid channel string duplication.
 */
export function useIpc<C extends InvokeChannel>(channel: C, options: UseIpcOptions<C> = {}): UseIpcResult<C> {
  const { autoInvoke = false, enabled = true, args, initialData = null } = options;
  const [data, setData] = useState<InvokeResult<C> | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const argsKey = useMemo(() => JSON.stringify(args ?? []), [args]);

  const invoke = useCallback(
    async (...params: InvokeArgs<C>): Promise<InvokeResult<C>> => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.arctisBridge.invoke(channel, ...params);
        setData(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [channel],
  );

  useEffect(() => {
    if (!autoInvoke || !enabled) {
      return;
    }
    void invoke(...((args ?? []) as InvokeArgs<C>));
  }, [autoInvoke, enabled, invoke, argsKey]);

  return {
    data,
    loading,
    error,
    invoke,
  };
}
