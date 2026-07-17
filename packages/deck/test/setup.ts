import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Node's experimental localStorage global shadows jsdom's and lacks the full
// Storage interface; replace it with a real in-memory implementation.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
});
Object.defineProperty(window, 'localStorage', {
  value: globalThis.localStorage,
  configurable: true,
});

// jsdom lacks or stubs a few browser APIs the deck touches; install quiet,
// deterministic stand-ins unconditionally so every environment behaves alike.
Element.prototype.scrollTo = () => undefined;
window.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
});
window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
  window.setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = (handle: number): void => {
  window.clearTimeout(handle);
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});
