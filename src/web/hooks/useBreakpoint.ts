import { useSyncExternalStore } from "react";

export type Breakpoint = "mobile" | "tablet" | "desktop";

const MOBILE_MAX = 639;
const TABLET_MAX = 1023;

function resolveBreakpoint(width: number): Breakpoint {
  if (width <= MOBILE_MAX) return "mobile";
  if (width <= TABLET_MAX) return "tablet";
  return "desktop";
}

function getSnapshot(): Breakpoint {
  if (typeof window === "undefined") return "desktop";
  return resolveBreakpoint(window.innerWidth);
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("resize", callback);
  window.addEventListener("orientationchange", callback);
  return () => {
    window.removeEventListener("resize", callback);
    window.removeEventListener("orientationchange", callback);
  };
}

function getServerSnapshot(): Breakpoint {
  return "desktop";
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useIsMobile(): boolean {
  return useBreakpoint() === "mobile";
}

export function useIsTabletOrSmaller(): boolean {
  const bp = useBreakpoint();
  return bp === "mobile" || bp === "tablet";
}
