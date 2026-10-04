import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { storeConfig } from '../config';
import { useOzi } from '../state/ozi';
import { useVoice } from '../state/voice';

/**
 * Ozi's button, on every screen (Anthony, 1 Oct 2026).
 *
 * Big and round, in the middle of the right-hand edge to start with, so it can be found without
 * hunting and is out of the way of what is on the screen. While Ozi is listening it is bright
 * green and glows outward. Muted, it turns white with a dashed edge, the microphone gets a line
 * through it, and its words change from "Listening" to "Muted". So the difference never rests on
 * colour alone: a person who cannot tell green from red, or cannot see colour at all, still has
 * the brightness, the shape, the movement and the words. Red was considered and not used,
 * because red and green are the pair colour-blind people most often confuse.
 *
 * It can be moved: hold it and drag, or focus it and use the arrow keys. A single press never
 * moves it, so moving is never needed to use it (WCAG 2.5.7), and a drag is never mistaken for
 * a press. Settings has a button to put it back.
 *
 * Everything Ozi says is shown beside it while it is said, and for a little while after.
 */

const SIZE = 124;
const DRAG_START_PX = 10;
const ARROW_STEP = 0.05;
const CAPTION_LINGER_MS = 8000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function OziBubble(): JSX.Element {
  const ozi = useOzi();
  const voice = useVoice();
  const assistant = storeConfig.assistantName;
  const position = voice.settings.bubble ?? { x: 0.92, y: 0.55 };
  const [dragAt, setDragAt] = useState<{ x: number; y: number } | null>(null);
  const [captionShown, setCaptionShown] = useState(false);
  const pointer = useRef<{ id: number; startX: number; startY: number; dragging: boolean } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const [screenSize, setScreenSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  // Follow the screen turning or resizing, so the button never ends up off the edge.
  useEffect(() => {
    const onResize = (): void => setScreenSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Keep the words beside the button while Ozi says them, and a little while after.
  useEffect(() => {
    if (ozi.said === '') return undefined;
    setCaptionShown(true);
    if (ozi.talking) return undefined;
    const timer = window.setTimeout(() => setCaptionShown(false), CAPTION_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [ozi.said, ozi.talking]);

  const shown = dragAt ?? position;
  // In pixels, kept wholly on the screen with a small margin, wherever it was put.
  const margin = 8;
  const left = clamp(shown.x * screenSize.w - SIZE / 2, margin, screenSize.w - SIZE - margin);
  const top = clamp(shown.y * screenSize.h - SIZE / 2, margin, screenSize.h - SIZE - margin);
  // Ozi's words sit on whichever side of the button has more room.
  const captionSide = left + SIZE / 2 > screenSize.w / 2 ? 'right-full mr-3' : 'left-full ml-3';
  const listening = ozi.presence === 'listening';
  const muted = ozi.presence === 'muted';

  const label = ozi.talking
    ? 'Talking'
    : listening
      ? 'Listening'
      : muted
        ? 'Muted'
        : ozi.presence === 'cannot-listen'
          ? 'Can’t listen'
          : 'Starting';
  // The button's name is exactly its visible word, so a voice control user says what they
  // see. What a press does is its description, read after the name.
  const action = ozi.talking
    ? `${assistant} is talking. Press to stop.`
    : listening
      ? `${assistant} is listening. Press to mute.`
      : muted
        ? `${assistant} is muted and not listening. Press to listen.`
        : ozi.presence === 'cannot-listen'
          ? `${assistant} can’t listen on this phone or browser. Press to hear why.`
          : `${assistant} is starting.`;

  function placeFromPointer(clientX: number, clientY: number): { x: number; y: number } {
    const half = SIZE / 2;
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

  return (
    <aside data-ozi aria-label={assistant} className="fixed z-50" style={{ left, top }}>
      <div
        className={
          captionShown && (ozi.said !== '' || ozi.heard !== '')
            ? `absolute top-0 ${captionSide} w-56 max-w-[60vw] max-h-[45vh] overflow-y-auto rounded-xl border-2 border-ink bg-paper text-ink p-3 m-0 shadow-lg text-base`
            : 'visually-hidden'
        }
      >
        {/* What Ozi heard, so anybody can see whether it heard them right. Not announced: the
            person who said it knows what they said. */}
        {ozi.heard !== '' && (
          <p className="m-0 mb-2 italic" aria-hidden="true">
            You said: {ozi.heard}
          </p>
        )}
        <p role="status" aria-live={captionLive} className="m-0">
          {ozi.said}
        </p>
      </div>
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
        style={{ width: SIZE, height: SIZE, borderRadius: '50%', touchAction: 'none' }}
        className={
          listening || ozi.talking
            ? 'control p-0 ozi-beaming rounded-full flex flex-col items-center justify-center gap-1 font-bold text-ink border-4 border-ink bg-[var(--colour-listening)] cursor-grab'
            : 'control p-0 rounded-full flex flex-col items-center justify-center gap-1 font-bold text-ink border-4 border-dashed border-ink bg-paper cursor-grab'
        }
      >
        <BubbleGlyph crossed={!listening && !ozi.talking} />
        <span className="text-base leading-tight">{label}</span>
      </button>
      <p id="ozi-bubble-hint" className="visually-hidden">
        {action} You can move this button: hold it and drag it, or use the arrow keys.
      </p>
    </aside>
  );
}

/** Decorative. The button already says what it is, in words. */
function BubbleGlyph({ crossed }: { crossed: boolean }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="36"
      height="36"
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
