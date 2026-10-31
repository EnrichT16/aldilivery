import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { storeConfig } from '../config';
import { useDockHeights, useMeasuredBar } from '../lib/dock';
import { useOzi } from '../state/ozi';
import { useVoice } from '../state/voice';

/**
 * Ozi's button, on every screen (Anthony, 1 Oct 2026).
 *
 * Big and round, in the middle of the right-hand edge to start with, so it can be found without
 * hunting and is out of the way of what is on the screen. While Ozi is listening it is bright
 * green and glows outward. Paused, it turns white with a dashed edge, the microphone gets a line
 * through it, and its words change from "Listening" to "Paused". So the difference never rests on
 * colour alone: a person who cannot tell green from red, or cannot see colour at all, still has
 * the brightness, the shape, the movement and the words. Red was considered and not used,
 * because red and green are the pair colour-blind people most often confuse.
 *
 * It can be moved: hold it and drag, or focus it and use the arrow keys. A single press never
 * moves it, so moving is never needed to use it (WCAG 2.5.7), and a drag is never mistaken for
 * a press. Settings has a button to put it back.
 *
 * Everything Ozi says is shown while it is said, and for a little while after, in a slim caption
 * bar docked at the foot of the screen, just above the bottom bars (19 October 2026: beside the
 * button it covered the landing page's doors). The bar is at most three lines tall and scrolls
 * inside; the page leaves room for it while it is shown, so it never sits over a control, and
 * "Hide words" puts it away at once.
 *
 * It keeps out of the way of forms (27 October 2026: on the Runner's documents it covered the
 * insurance date and the share code box). While somebody is typing in a box it steps aside
 * altogether, and comes back when they leave the box. Once the page is scrolled down, away from
 * the top and the room kept at the foot, it shrinks to a small round microphone tucked into the
 * corner; its word stays as its name, so a screen reader or voice control still finds it by it.
 */

const FULL_SIZE = 124;
/** Small, while the page is scrolled, and still a comfortable target (WCAG 2.5.5 asks for 44). */
const COMPACT_SIZE = 60;
/** Scrolled less than this from the top, or from the foot, it is shown full size. */
const SCROLL_SLACK_PX = 40;
/** The room the round button needs at the foot of a page, so nothing ends up under it. */
export const BUBBLE_ROOM = FULL_SIZE + 16;
const DRAG_START_PX = 10;
const ARROW_STEP = 0.05;
const CAPTION_LINGER_MS = 8000;

/** A box somebody types or picks in, where the button would sit over what they are doing. */
function isTypingField(element: Element | null): boolean {
  if (!element || element.closest('[data-ozi]')) return false;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) {
    return ![
      'button',
      'checkbox',
      'radio',
      'file',
      'submit',
      'reset',
      'range',
      'color',
      'image',
    ].includes(element.type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/** Scrolled down into the page, away from the top and from the room kept at the foot. */
function isScrolledIn(): boolean {
  const below = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
  return window.scrollY > SCROLL_SLACK_PX && below > SCROLL_SLACK_PX;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The word on Ozi's button for its state; the same on the round button and the bottom bar. */
export function presenceWord(ozi: {
  talking: boolean;
  presence: string;
  waiting?: boolean;
}): string {
  if (ozi.talking) return 'Talking';
  if (ozi.waiting) return 'One moment';
  switch (ozi.presence) {
    case 'listening':
      return 'Listening';
    case 'muted':
      return 'Paused';
    case 'needs-tap':
      return 'Tap to talk';
    case 'cannot-listen':
      return 'Can’t listen';
    default:
      return 'Starting';
  }
}

/**
 * `docked`: the signed-in Shopper's bottom bar carries Ozi's button (19 October 2026), so the
 * round one is not drawn over the cards; the words still show in the caption bar.
 */
export function OziBubble({ docked = false }: { docked?: boolean } = {}): JSX.Element {
  const ozi = useOzi();
  const voice = useVoice();
  const assistant = storeConfig.assistantName;
  // Bottom right to start with, above the bars (20 October 2026: in the middle of the edge it
  // sat over the first screen's buttons). Anyone can still move it.
  const position = voice.settings.bubble ?? { x: 0.92, y: 1 };
  const [dragAt, setDragAt] = useState<{ x: number; y: number } | null>(null);
  const [captionShown, setCaptionShown] = useState(false);
  const pointer = useRef<{ id: number; startX: number; startY: number; dragging: boolean } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const [screenSize, setScreenSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const bars = useDockHeights();
  const captionRef = useRef<HTMLDivElement>(null);
  const [typing, setTyping] = useState(() => isTypingField(document.activeElement));
  const [scrolledIn, setScrolledIn] = useState(false);

  // Out of the way while somebody types in a box, back when they leave it.
  useEffect(() => {
    const onFocus = (): void => setTyping(isTypingField(document.activeElement));
    // Focus has not yet moved on when focusout fires, so look a moment later.
    const onBlur = (): void => void window.setTimeout(onFocus, 0);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
    };
  }, []);

  // Small while the page is scrolled down into it; full size at the top and at the foot.
  useEffect(() => {
    let frame = 0;
    const onScroll = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setScrolledIn(isScrolledIn());
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  // Follow the screen turning or resizing, so the button never ends up off the edge.
  useEffect(() => {
    const onResize = (): void => setScreenSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Keep the words in the caption bar while Ozi says them, and a little while after.
  useEffect(() => {
    if (ozi.said === '') return undefined;
    setCaptionShown(true);
    if (ozi.talking) return undefined;
    const timer = window.setTimeout(() => setCaptionShown(false), CAPTION_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [ozi.said, ozi.talking]);

  const shown = dragAt ?? position;
  // Never small while it is being moved, so it stays easy to hold.
  const compact = scrolledIn && !dragAt;
  const size = compact ? COMPACT_SIZE : FULL_SIZE;
  // In pixels, kept wholly on the screen with a small margin, wherever it was put. Small, it
  // tucks closer into the edge.
  const margin = compact ? 4 : 8;
  const left = clamp(shown.x * screenSize.w - size / 2, margin, screenSize.w - size - margin);
  // Never down over the bars at the foot of the screen.
  const top = clamp(
    shown.y * screenSize.h - size / 2,
    margin,
    Math.max(margin, screenSize.h - size - margin - bars.dock),
  );
  const listening = ozi.presence === 'listening';
  const paused = ozi.presence === 'muted';

  const label = ozi.talking
    ? 'Talking'
    : ozi.waiting
      ? 'One moment'
      : listening
        ? 'Listening'
        : paused
          ? 'Paused'
          : ozi.presence === 'needs-tap'
            ? 'Tap to talk'
            : ozi.presence === 'cannot-listen'
              ? 'Can’t listen'
              : 'Starting';
  // The button's name is exactly its visible word, so a voice control user says what they
  // see. What a press does is its description, read after the name.
  const action = ozi.talking
    ? `${assistant} is talking. Press to stop.`
    : ozi.waiting
      ? `${assistant} is working out an answer. One moment.`
      : listening
        ? `${assistant} is listening. Press to pause.`
        : paused
          ? `${assistant} is paused and not listening. Press to listen.`
          : ozi.presence === 'needs-tap'
            ? `${assistant} is ready. Press to talk; your phone will ask to use the microphone.`
            : ozi.presence === 'cannot-listen'
              ? `${assistant} can’t listen on this phone or browser. Press to hear why.`
              : `${assistant} is starting.`;

  function placeFromPointer(clientX: number, clientY: number): { x: number; y: number } {
    const half = size / 2;
    return {
      x: clamp(clientX, half, window.innerWidth - half) / window.innerWidth,
      y: clamp(clientY, half, window.innerHeight - half) / window.innerHeight,
    };
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>): void {
    pointer.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>): void {
    const p = pointer.current;
    if (!p || p.id !== event.pointerId) return;
    if (
      !p.dragging &&
      Math.hypot(event.clientX - p.startX, event.clientY - p.startY) < DRAG_START_PX
    ) {
      return;
    }
    p.dragging = true;
    setDragAt(placeFromPointer(event.clientX, event.clientY));
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>): void {
    const p = pointer.current;
    pointer.current = null;
    if (!p?.dragging) return;
    suppressClick.current = true;
    const place = placeFromPointer(event.clientX, event.clientY);
    setDragAt(null);
    voice.update({ bubble: place });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-ARROW_STEP, 0],
      ArrowRight: [ARROW_STEP, 0],
      ArrowUp: [0, -ARROW_STEP],
      ArrowDown: [0, ARROW_STEP],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    voice.update({
      bubble: {
        x: clamp(position.x + move[0], 0.05, 0.95),
        y: clamp(position.y + move[1], 0.05, 0.95),
      },
    });
  }

  const captionLive = voice.speaking && !ozi.announce ? 'off' : 'polite';
  // A microphone note or the tap button already shows these words in their own place on the
  // page, so they are not put over the form beside the button as well (ruling 62).
  const captionText = ozi.captionOff ? '' : ozi.said;
  const captionVisible = captionShown && (captionText !== '' || ozi.heard !== '');
  useMeasuredBar('caption', captionRef, captionVisible);

  return (
    <aside data-ozi aria-label={assistant} className="fixed z-50" style={{ left, top }}>
      <div
        ref={captionRef}
        className={
          captionVisible ? 'fixed inset-x-0 z-50 px-3 pb-2 pointer-events-none' : 'visually-hidden'
        }
        style={captionVisible ? { bottom: bars.dock } : undefined}
      >
        <div
          className={
            captionVisible
              ? 'pointer-events-auto mx-auto w-full max-w-3xl flex items-start gap-2 rounded-2xl border-2 border-ink bg-paper text-ink shadow-lg py-1 pl-4 pr-1'
              : undefined
          }
        >
          <div
            className={
              captionVisible
                ? 'flex-1 min-w-0 max-h-[4.55rem] scroll-pane py-1 text-base'
                : undefined
            }
          >
            {/* What Ozi heard, so anybody can see whether it heard them right. Not announced:
                the person who said it knows what they said. */}
            {ozi.heard !== '' && (
              <p className="m-0 italic leading-snug" aria-hidden="true">
                You said: {ozi.heard}
              </p>
            )}
            <p role="status" aria-live={captionLive} className="m-0 leading-snug">
              {ozi.waiting && !ozi.talking ? 'One moment…' : captionText}
            </p>
          </div>
          {captionVisible && (
            <button
              type="button"
              onClick={() => setCaptionShown(false)}
              className="control shrink-0 flex-col gap-0 w-24 !px-1 !py-1 leading-tight bg-ink/10 text-ink"
            >
              <span aria-hidden="true">×</span> Hide words
            </button>
          )}
        </div>
      </div>
      {!docked && !typing && (
        <button
          type="button"
          aria-describedby="ozi-bubble-hint"
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            ozi.press();
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
          style={{ width: size, height: size, borderRadius: '50%', touchAction: 'none' }}
          className={
            listening || ozi.talking
              ? 'control p-0 ozi-beaming !rounded-full flex flex-col items-center justify-center gap-1 font-bold text-on-accent border-4 border-ink bg-listening cursor-grab'
              : 'control p-0 !rounded-full flex flex-col items-center justify-center gap-1 font-bold text-ink border-4 border-dashed border-ink bg-paper cursor-grab'
          }
        >
          <BubbleGlyph crossed={!listening && !ozi.talking} small={compact} />
          <span className={compact ? 'visually-hidden' : 'text-base leading-tight'}>{label}</span>
        </button>
      )}
      <p id="ozi-bubble-hint" className="visually-hidden">
        {action} You can move this button: hold it and drag it, or use the arrow keys.
      </p>
    </aside>
  );
}

/** Decorative. The button already says what it is, in words. */
function BubbleGlyph({ crossed, small }: { crossed: boolean; small: boolean }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={small ? 28 : 36}
      height={small ? 28 : 36}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
      {crossed && <line x1="3" y1="3" x2="21" y2="21" strokeWidth="2.8" />}
    </svg>
  );
}
