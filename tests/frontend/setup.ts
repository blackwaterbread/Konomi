import "@testing-library/jest-dom/vitest";
import "@/lib/i18n";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import i18n from "@/lib/i18n";
import { preloadMocks, resetPreloadMocks } from "./helpers/preload-mocks";
import type { KonomiApi } from "@/api";

vi.mock("@/api/context", async () => {
  const actual = await vi.importActual<typeof import("@/api/context")>(
    "@/api/context",
  );
  return {
    ...actual,
    useApi: (): KonomiApi =>
      ({
        ...preloadMocks,
        appInfo: { ...preloadMocks.appInfo, isElectron: false },
      }) as unknown as KonomiApi,
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  Toaster: () => null,
  useSonner: () => ({
    toasts: [],
  }),
}));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(window, "requestAnimationFrame", {
  writable: true,
  value: (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16),
});

Object.defineProperty(window, "cancelAnimationFrame", {
  writable: true,
  value: (handle: number) => window.clearTimeout(handle),
});

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    readText: vi.fn().mockResolvedValue(""),
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class MockIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.stubGlobal("ResizeObserver", MockResizeObserver);
vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
vi.stubGlobal("PointerEvent", MouseEvent);

Object.defineProperty(Element.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

beforeEach(async () => {
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
  await i18n.changeLanguage("en");
  resetPreloadMocks();
});

afterEach(() => {
  cleanup();
});
