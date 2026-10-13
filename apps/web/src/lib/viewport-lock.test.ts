import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_HEIGHT_VAR,
  APP_OFFSET_VAR,
  APP_VIEWPORT_LOCK_CLASS,
  lockAppViewport,
} from './viewport-lock';

interface MockVisualViewport {
  height: number;
  offsetTop: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  listeners: Map<string, Set<() => void>>;
  dispatch(type: string): void;
}

function createStyle() {
  const properties = new Map<string, string>();
  return {
    scrollBehavior: '',
    setProperty(name: string, value: string) {
      properties.set(name, value);
    },
    removeProperty(name: string) {
      properties.delete(name);
      if (name === 'scroll-behavior') {
        this.scrollBehavior = '';
      }
    },
    getPropertyValue(name: string) {
      return properties.get(name) ?? '';
    },
  };
}

function mockVisualViewport(height: number, offsetTop = 0): MockVisualViewport {
  const listeners = new Map<string, Set<() => void>>();
  const visualViewport: MockVisualViewport = {
    height,
    offsetTop,
    listeners,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    }),
    dispatch(type: string) {
      listeners.get(type)?.forEach((listener) => listener());
    },
  };
  return visualViewport;
}

function installDom(options: { visualViewport?: MockVisualViewport | null; innerHeight?: number }) {
  const classNames = new Set<string>();
  const style = createStyle();
  const meta = {
    content: 'width=device-width, initial-scale=1.0',
    getAttribute(name: string) {
      return name === 'content' ? this.content : null;
    },
    setAttribute(name: string, value: string) {
      if (name === 'content') {
        this.content = value;
      }
    },
  };
  const html = {
    classList: {
      add: (value: string) => classNames.add(value),
      remove: (value: string) => classNames.delete(value),
      contains: (value: string) => classNames.has(value),
    },
    style,
    scrollTop: 0,
  };
  const windowListeners = new Map<string, Set<() => void>>();
  const windowObject = {
    visualViewport: options.visualViewport ?? null,
    innerHeight: options.innerHeight ?? 800,
    scrollTo: vi.fn(),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      const set = windowListeners.get(type) ?? new Set();
      set.add(listener);
      windowListeners.set(type, set);
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      windowListeners.get(type)?.delete(listener);
    }),
  };

  vi.stubGlobal('document', {
    documentElement: html,
    body: { scrollTop: 0 },
    querySelector: (selector: string) => (selector === 'meta[name="viewport"]' ? meta : null),
  });
  vi.stubGlobal('window', windowObject);

  return { html, meta, windowObject };
}

describe('lockAppViewport', () => {
  let unlock: (() => void) | undefined;

  beforeEach(() => {
    unlock = undefined;
  });

  afterEach(() => {
    unlock?.();
    unlock = undefined;
    vi.unstubAllGlobals();
  });

  it('sizes the locked viewport to the visual viewport', () => {
    const visualViewport = mockVisualViewport(640, 12);
    const { html } = installDom({ visualViewport });
    unlock = lockAppViewport();

    expect(html.classList.contains(APP_VIEWPORT_LOCK_CLASS)).toBe(true);
    expect(html.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('640px');
    expect(html.style.getPropertyValue(APP_OFFSET_VAR)).toBe('12px');
  });

  it('shrinks when the keyboard reduces the visual viewport', () => {
    const visualViewport = mockVisualViewport(800);
    const { html } = installDom({ visualViewport });
    unlock = lockAppViewport();

    visualViewport.height = 420;
    visualViewport.offsetTop = 0;
    visualViewport.dispatch('resize');

    expect(html.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('420px');
  });

  it('falls back to innerHeight when visualViewport is missing', () => {
    const { html } = installDom({ visualViewport: null, innerHeight: 712 });
    unlock = lockAppViewport();

    expect(html.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('712px');
    expect(html.style.getPropertyValue(APP_OFFSET_VAR)).toBe('0px');
  });

  it('asks Chrome to resize the layout viewport for the keyboard', () => {
    const visualViewport = mockVisualViewport(700);
    const { meta } = installDom({ visualViewport });
    unlock = lockAppViewport();

    expect(meta.getAttribute('content')).toContain('interactive-widget=resizes-content');

    unlock();
    unlock = undefined;
    expect(meta.getAttribute('content')).toBe('width=device-width, initial-scale=1.0');
  });

  it('clears viewport variables on unlock', () => {
    const visualViewport = mockVisualViewport(600);
    const { html } = installDom({ visualViewport });
    unlock = lockAppViewport();
    unlock();
    unlock = undefined;

    expect(html.classList.contains(APP_VIEWPORT_LOCK_CLASS)).toBe(false);
    expect(html.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('');
    expect(html.style.getPropertyValue(APP_OFFSET_VAR)).toBe('');
  });
});
