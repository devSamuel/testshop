import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

const originalGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = (element: Element) => originalGetComputedStyle(element);
window.HTMLElement.prototype.scrollIntoView = () => undefined;
window.scrollTo = () => undefined;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverStub {
  observe() {
    return undefined;
  }
  unobserve() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
}

window.ResizeObserver = ResizeObserverStub;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
