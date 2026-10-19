import { useEffect, useSyncExternalStore, type RefObject } from 'react';

/**
 * The bars fixed to the bottom of the screen (19 October 2026): the Shopper's bottom
 * navigation, the switch that turns talking out loud on and off, and the caption bar with
 * Ozi's words. Each measures itself here, so the page can leave room for them and nothing on
 * it is ever hidden behind them: the page gets that much padding at its foot, and anything
 * focused is scrolled clear of them (`scroll-padding-bottom`).
 */

type Part = 'dock' | 'caption';

const heights: Record<Part, number> = { dock: 0, caption: 0 };
const listeners = new Set<() => void>();
let snapshot = { ...heights };

function publish(part: Part, height: number): void {
  const rounded = Math.ceil(height);
  if (heights[part] === rounded) return;
  heights[part] = rounded;
  snapshot = { ...heights };
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty(`--${part}-height`, `${rounded}px`);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How tall the fixed bottom bars are just now, in pixels. */
export function useDockHeights(): { dock: number; caption: number } {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

/** Measures an element fixed to the bottom of the screen, while it is there. */
export function useMeasuredBar(part: Part, ref: RefObject<HTMLElement>, shown = true): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !shown) {
      publish(part, 0);
      return undefined;
    }
    const measure = (): void => publish(part, element.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => {
        window.removeEventListener('resize', measure);
        publish(part, 0);
      };
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      publish(part, 0);
    };
  }, [part, ref, shown]);
}
