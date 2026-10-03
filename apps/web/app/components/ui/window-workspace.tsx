"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";

type WindowStore = ReturnType<typeof createWindowStore>;
const Memory = createContext<WindowStore | null>(null);

/** Per-save, per-tab memory. It stores drafts and UI choices, never world data. */
function createWindowStore(scope: string) {
  let values: Record<string, unknown> = {};
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    get: (key: string) => values[key],
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load: () => {
      try {
        const saved: unknown = JSON.parse(sessionStorage.getItem(`chronica:windows:${scope}`) ?? "{}");
        if (saved !== null && typeof saved === "object" && !Array.isArray(saved)) values = saved as Record<string, unknown>;
      } catch { /* Storage may be disabled; in-memory drafts still survive closing. */ }
      notify();
    },
    set: (key: string, value: unknown) => {
      values = { ...values, [key]: value };
      try { sessionStorage.setItem(`chronica:windows:${scope}`, JSON.stringify(values)); } catch { /* Keep the in-memory copy. */ }
      notify();
    },
  };
}

export interface WindowReference {
  readonly content: ReactNode;
  readonly open: (key: string) => void;
  readonly navigation?: ReactNode;
}
const Reference = createContext<WindowReference | null>(null);

export function WindowWorkspace({ scope, reference, children }: { readonly scope: string; readonly reference: WindowReference; readonly children: ReactNode }) {
  const store = useMemo(() => createWindowStore(scope), [scope]);
  useEffect(() => { store.load(); }, [store]);
  return <Memory.Provider value={store}><Reference.Provider value={reference}>{children}</Reference.Provider></Memory.Provider>;
}

export const useWindowReference = () => useContext(Reference);

export function useWindowState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const store = useContext(Memory);
  const [local, setLocal] = useState(initial);
  const subscribe = useCallback((listener: () => void) => store?.subscribe(listener) ?? (() => {}), [store]);
  const getSnapshot = useCallback(() => store?.get(key), [store, key]);
  const saved = useSyncExternalStore(subscribe, getSnapshot, () => undefined);
  const value = store === null ? local : saved === undefined ? initial : saved as T;
  const set = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    if (store === null) { setLocal(next); return; }
    const previous = store.get(key);
    store.set(key, typeof next === "function" ? (next as (was: T) => T)(previous === undefined ? initial : previous as T) : next);
  }, [store, key, initial]);
  return [value, set];
}
