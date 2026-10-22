import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

import {
  addPartnerProduct,
  scanBarcode,
  scanLabel,
  type PartnerProductRow,
  type ScanDraft,
} from '../lib/api';
import { click } from '../lib/alert';
import { money } from '../lib/money';
import { preparePhoto, type ReadyPhoto } from '../lib/photo';
import { spokenMoney } from '../voice/staff-voice';

/**
 * Scanning products into the Shop Partner dashboard (22 October 2026, ruling 75).
 *
 * The camera opens (the rear one) and captures by itself, with no button to press: when it sees
 * a barcode (the browser's own barcode reader where there is one, otherwise a small barcode
 * library loaded only when the camera opens), or when the picture is held steady on a shelf
 * price label for about a second and a half, when the frame is sent to be read by the language
 * model. Each capture becomes a draft in a list the shop corrects by typing or by voice; nothing
 * reaches the catalogue until the shop says or presses "Add all", and then it goes through the
 * ordinary add-a-product route, so every product is still checked by a person.
 *
 * One product is one listing with one price, however many packs are on the shelf: the same
 * barcode, or the same name and price, is never added twice ("already added"). A label with no
 * price gets an estimate, marked "estimate, please check". Every capture is said aloud and
 * shown in words, with a click and a buzz, so the whole thing works without seeing the screen.
 */

/** How often the camera's picture is looked at. Three steady looks make a second and a half. */
const LOOK_EVERY_MS = 500;
const STEADY_LOOKS = 3;
/** Average change in brightness, out of 255, below which two looks are "the same picture". */
const STEADY_BELOW = 6;
/** How far the picture must move from the last label sent before another is sent. */
const MOVED_ABOVE = 18;
/** The same barcode seen again within this long is the same sighting, said nothing about. */
const SAME_CODE_MS = 4000;

export interface Draft {
  key: string;
  name: string;
  /** As typed or said, in pounds: "2.40". */
  priceText: string;
  /** The label showed no price: an estimate, "please check". Typing a price clears it. */
  priceEstimated: boolean;
  barcode: string | null;
  /** A frame from the camera, kept only for a shop on Partner Plus. */
  photo: ReadyPhoto | null;
  problem: string;
}

/** Something that finds a barcode in what the camera sees, or says there is none. */
export interface CodeFinder {
  find(video: HTMLVideoElement): Promise<string | null>;
}

interface ScannerDevices {
  openCamera: () => Promise<MediaStream>;
  findCodes: () => Promise<CodeFinder | null>;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
type BarcodeDetectorConstructor = {
  new (options?: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

const PRODUCT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

/** The browser's own barcode reader where it has one; otherwise the library, loaded now. */
async function defaultFindCodes(): Promise<CodeFinder | null> {
  const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;
  if (Detector) {
    try {
      const supported = (await Detector.getSupportedFormats?.()) ?? PRODUCT_FORMATS;
      const formats = PRODUCT_FORMATS.filter((format) => supported.includes(format));
      const detector = new Detector({ formats: formats.length ? formats : PRODUCT_FORMATS });
      return {
        async find(video) {
          const [code] = await detector.detect(video);
          return code?.rawValue ?? null;
        },
      };
    } catch {
      // Fall through to the library.
    }
  }
  try {
    const { BrowserMultiFormatOneDReader } = await import('@zxing/browser');
    const reader = new BrowserMultiFormatOneDReader();
    const canvas = document.createElement('canvas');
    return {
      async find(video) {
        if (!video.videoWidth) return null;
        const scale = Math.min(1, 800 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const context = canvas.getContext('2d');
        if (!context) return null;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          return reader.decodeFromCanvas(canvas).getText();
        } catch {
          return null;
        }
      },
    };
  } catch {
    return null;
  }
}

let devices: ScannerDevices = {
  openCamera: () =>
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    }),
  findCodes: defaultFindCodes,
};

/** For tests: a stand-in camera and barcode finder, or null for the real ones. */
export function setScannerDevices(stand: Partial<ScannerDevices> | null): void {
  devices = stand
    ? { ...devices, ...stand }
    : {
        openCamera: () =>
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false,
          }),
        findCodes: defaultFindCodes,
      };
}

/** A product's name as two are compared: "Apples, 6 pack" and "apples 6-pack" are the same. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Pounds as typed or said ("2.40", "£2.40", "two pounds forty"), in pence, or null. */
export function pencePrice(text: string): number | null {
  const plain = text.replace(/[£\s]/g, '');
  if (/^\d+(\.\d{1,2})?$/.test(plain)) {
    const pence = Math.round(Number(plain) * 100);
    return pence > 0 ? pence : null;
  }
  return spokenMoney(text);
}

function priceText(pence: number | null): string {
  return pence === null ? '' : (pence / 100).toFixed(2);
}

/**
 * The listing this one would repeat, among the drafts and the shop's own products: the same
 * barcode, or the same name and the same price. One product is one listing (ruling 75).
 */
export function alreadyThere(
  candidate: { name: string; pricePence: number | null; barcode: string | null },
  drafts: Draft[],
  products: Array<
    Pick<PartnerProductRow, 'name' | 'pricePence' | 'status'> & { barcode?: string | null }
  >,
): string | null {
  const key = nameKey(candidate.name);
  const same = (name: string, pence: number | null, barcode: string | null | undefined): boolean =>
    (candidate.barcode !== null && barcode === candidate.barcode) ||
    (key !== '' && nameKey(name) === key && pence !== null && pence === candidate.pricePence);
  const draft = drafts.find((row) => same(row.name, pencePrice(row.priceText), row.barcode));
  if (draft) return draft.name || 'That product';
  const product = products.find(
    (row) =>
      (row.status === 'approved' || row.status === 'pending') &&
      same(row.name, row.pricePence, row.barcode),
  );
  return product ? product.name : null;
}

export type ScanVoice =
  | { kind: 'add-all' }
  | { kind: 'price'; name: string | null; pricePence: number | null }
  | { kind: 'rename'; name: string | null; to: string }
  | { kind: 'remove'; name: string | null }
  | { kind: 'read' }
  | { kind: 'start' }
  | { kind: 'stop' };

/** What a shop says about its scanned list, or null for anything else. */
export function understandScanVoice(said: string): ScanVoice | null {
  const text = said.trim().replace(/[.!?]+$/, '');
  const lower = text.toLowerCase();
  if (/^(add|send) (them |it )?all\b|^add everything\b|^add the lot\b/.test(lower)) {
    return { kind: 'add-all' };
  }
  if (/^(stop|close) (scanning|the camera)\b|^stop the camera\b/.test(lower)) {
    return { kind: 'stop' };
  }
  if (/^(start scanning|scan (my )?products|scan|open the camera)\b/.test(lower)) {
    return { kind: 'start' };
  }
  if (
    /\b(read|what'?s on|what is on) (the|my) list\b|\bwhat have (i|we) (got|scanned)\b/.test(lower)
  ) {
    return { kind: 'read' };
  }
  const itsPrice = /^(?:the |its |it'?s )?price (?:is|of it is|should be) (.+)$/i.exec(text);
  if (itsPrice) return { kind: 'price', name: null, pricePence: spokenMoney(itsPrice[1]!) };
  const price =
    /^(?:change|set|make)\s+(?:the\s+)?(?:price\s+of\s+)?(?:the\s+)?(.+?)\s+(?:to|at)\s+(.+)$/i.exec(
      text,
    );
  if (
    price &&
    /\d|pound|quid|pence|p\b|one|two|three|four|five|six|seven|eight|nine|ten/i.test(price[2]!)
  ) {
    const name = /^(it|that|the last one)$/i.test(price[1]!) ? null : price[1]!;
    return { kind: 'price', name, pricePence: spokenMoney(price[2]!) };
  }
  const callIt = /^(?:call|name) (?:it|that|the last one) (.+)$/i.exec(text);
  if (callIt) return { kind: 'rename', name: null, to: callIt[1]!.trim() };
  const rename = /^rename (?:the )?(.+?) (?:to|as) (.+)$/i.exec(text);
  if (rename) return { kind: 'rename', name: rename[1]!, to: rename[2]!.trim() };
  const remove = /^(?:remove|delete|take out|take off|drop) (?:the )?(.+)$/i.exec(text);
  if (remove) {
    return {
      kind: 'remove',
      name: /^(it|that|the last one)$/i.test(remove[1]!) ? null : remove[1]!,
    };
  }
  return null;
}

/** The little picture the steadiness check compares: brightness at 32 by 24 points. */
function signature(video: HTMLVideoElement, canvas: HTMLCanvasElement): Uint8ClampedArray | null {
  if (!video.videoWidth) return null;
  canvas.width = 32;
  canvas.height = 24;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, 32, 24);
  const rgba = context.getImageData(0, 0, 32, 24).data;
  const grey = new Uint8ClampedArray(32 * 24);
  for (let point = 0; point < grey.length; point += 1) {
    grey[point] = (rgba[point * 4]! + rgba[point * 4 + 1]! + rgba[point * 4 + 2]!) / 3;
  }
  return grey;
}

/** How different two little pictures are: the average change in brightness. */
export function difference(a: Uint8ClampedArray | null, b: Uint8ClampedArray | null): number {
  if (!a || !b || a.length !== b.length) return 255;
  let total = 0;
  for (let point = 0; point < a.length; point += 1) total += Math.abs(a[point]! - b[point]!);
  return total / a.length;
}

/** The camera's picture now, as a JPEG ready to send, or null where it cannot be drawn. */
function frame(video: HTMLVideoElement): ReadyPhoto | null {
  if (!video.videoWidth) return null;
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.85);
  const match = /^data:([^;]+);base64,(.+)$/.exec(url ?? '');
  return match ? { contentType: match[1]!, base64: match[2]! } : null;
}

function buzzOnce(): void {
  try {
    navigator.vibrate?.(80);
  } catch {
    // No vibration on this device.
  }
}

let draftNumber = 0;

export function ProductScanner({
  plus,
  placesLeft,
  products,
  say,
  confirm,
  onAdded,
  registerVoice,
}: {
  /** Partner Plus: the camera's frame becomes the product's photo. */
  plus: boolean;
  /** How many more a free listing may carry, or null for no limit. */
  placesLeft: number | null;
  products: PartnerProductRow[];
  say: (words: string) => void;
  /** Ask a yes or no question aloud, then call back with the answer. */
  confirm: (question: string, then: (yes: boolean) => void) => void;
  onAdded: () => void;
  /** The dashboard hands what Ozi hears here first, while there is something to talk about. */
  registerVoice: (handler: ((text: string) => boolean) | null) => void;
}): JSX.Element {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [scanning, setScanning] = useState(false);
  const [news, setNews] = useState('');
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const live = useRef({ drafts, products, plus, say, placesLeft });
  live.current = { drafts, products, plus, say, placesLeft };

  const tell = useCallback((words: string): void => {
    setNews(words);
    live.current.say(words);
  }, []);

  /** A capture becomes a draft, unless that product is listed or drafted already. */
  const take = useCallback(
    (found: ScanDraft, photo: ReadyPhoto | null): void => {
      const { drafts: now, products: listed, plus: onPlus } = live.current;
      const repeat = alreadyThere(found, now, listed);
      if (repeat) {
        tell(`Already added: ${repeat}.`);
        return;
      }
      draftNumber += 1;
      const draft: Draft = {
        key: `draft-${draftNumber}`,
        name: found.name,
        priceText: priceText(found.pricePence),
        priceEstimated: found.priceEstimated,
        barcode: found.barcode,
        photo: onPlus ? photo : null,
        problem: '',
      };
      live.current.drafts = [...now, draft];
      setDrafts((before) => [...before, draft]);
      click();
      buzzOnce();
      if (!found.name) {
        tell(
          `Got a barcode, but I do not know that product. Please type its name, or say "call it" and the name.`,
        );
        return;
      }
      const price =
        found.pricePence === null
          ? 'no price yet, please give one'
          : `${money(found.pricePence)}${found.priceEstimated ? ', an estimate, please check' : ''}`;
      tell(`Got it: ${found.name}, ${price}.`);
    },
    [tell],
  );

  const readPhoto = useCallback(
    async (photo: ReadyPhoto): Promise<void> => {
      try {
        const result = await scanLabel(photo.base64, photo.contentType);
        if (result.draft) take(result.draft, photo);
        else if (result.message) tell(result.message);
      } catch (failure) {
        tell(failure instanceof Error ? failure.message : 'That label could not be read.');
      }
    },
    [take, tell],
  );

  const stop = useCallback((): void => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = async (): Promise<void> => {
    let opened: MediaStream;
    try {
      opened = await devices.openCamera();
    } catch {
      tell(
        'The camera could not be opened. Please allow the camera for this site, or use Take a photo.',
      );
      return;
    }
    stream.current = opened;
    setScanning(true);
    const element = video.current;
    if (element) {
      element.srcObject = opened;
      try {
        await element.play();
      } catch {
        // Some browsers play by themselves once the stream is set.
      }
    }
    tell(
      'The camera is on. Point it at a barcode, or hold it still on a shelf price label. I will say each product I find.',
    );
    const finder = await devices.findCodes();
    const small = document.createElement('canvas');
    let previous: Uint8ClampedArray | null = null;
    let lastSent: Uint8ClampedArray | null = null;
    let steady = 0;
    let armed = true;
    let reading = false;
    const recent = new Map<string, number>();
    timer.current = window.setInterval(() => {
      const source = video.current;
      if (!source || reading) return;
      void (async () => {
        reading = true;
        try {
          const code = finder ? await finder.find(source).catch(() => null) : null;
          const digits = code?.replace(/\D/g, '') ?? '';
          if (/^\d{8,14}$/.test(digits)) {
            const seenAt = recent.get(digits);
            recent.set(digits, Date.now());
            if (seenAt !== undefined && Date.now() - seenAt < SAME_CODE_MS) return;
            const picture = live.current.plus ? frame(source) : null;
            const repeat = alreadyThere(
              { name: '', pricePence: null, barcode: digits },
              live.current.drafts,
              live.current.products,
            );
            if (repeat) {
              tell(`Already added: ${repeat}.`);
              return;
            }
            const result = await scanBarcode(digits).catch(() => ({
              draft: { name: '', pricePence: null, priceEstimated: false, barcode: digits },
            }));
            take(result.draft, picture);
            armed = false;
            lastSent = signature(source, small);
            return;
          }
          // No barcode: a label held steady for a second and a half is read.
          const look = signature(source, small);
          if (!look) return;
          steady = difference(look, previous) < STEADY_BELOW ? steady + 1 : 0;
          previous = look;
          if (!armed && difference(look, lastSent) > MOVED_ABOVE) armed = true;
          if (armed && steady >= STEADY_LOOKS) {
            const picture = frame(source);
            if (!picture) return;
            armed = false;
            lastSent = look;
            steady = 0;
            setNews('Reading the label…');
            await readPhoto(picture);
          }
        } finally {
          reading = false;
        }
      })();
    }, LOOK_EVERY_MS);
  };

  const startRef = useRef(start);
  startRef.current = start;

  const fromFiles = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    if (files.length === 0) return;
    setNews(files.length === 1 ? 'Reading the label…' : `Reading ${files.length} labels…`);
    for (const file of files) {
      try {
        await readPhoto(await preparePhoto(file));
      } catch (failure) {
        tell(failure instanceof Error ? failure.message : 'That photo could not be read.');
      }
    }
  };

  const change = (key: string, patch: Partial<Draft>): void =>
    setDrafts((before) => before.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const remove = (key: string): void =>
    setDrafts((before) => before.filter((row) => row.key !== key));

  /** "Add all": each draft through the ordinary add-a-product route, so each is checked. */
  const addAll = useCallback(async (): Promise<void> => {
    const list = live.current.drafts;
    if (list.length === 0) return;
    setBusy(true);
    let sent = 0;
    const kept: Draft[] = [];
    let left = live.current.placesLeft;
    for (const draft of list) {
      const pence = pencePrice(draft.priceText);
      if (draft.name.trim().length < 2 || pence === null) {
        kept.push({ ...draft, problem: 'Please give its name and its price in pounds.' });
        continue;
      }
      if (left !== null && left <= 0) {
        kept.push({
          ...draft,
          problem:
            'Your free listing is full. Partner Plus carries your full catalogue, with photos.',
        });
        continue;
      }
      try {
        await addPartnerProduct({
          name: draft.name.trim(),
          pricePence: pence,
          tags: '',
          ...(draft.barcode ? { barcode: draft.barcode } : {}),
          ...(draft.priceEstimated ? { priceEstimated: true } : {}),
          ...(live.current.plus && draft.photo
            ? { photo: draft.photo.base64, photoType: draft.photo.contentType }
            : {}),
        });
        sent += 1;
        if (left !== null) left -= 1;
      } catch (failure) {
        kept.push({
          ...draft,
          problem: failure instanceof Error ? failure.message : 'That one could not be added.',
        });
      }
    }
    live.current.drafts = kept;
    setDrafts(kept);
    setBusy(false);
    if (sent > 0) onAdded();
    tell(
      `${sent === 0 ? 'Nothing was sent.' : `Sent ${sent} product${sent === 1 ? '' : 's'} to be checked.`}` +
        (kept.length > 0
          ? ` ${kept.length} still in the list: ${kept[0]!.problem}`
          : sent > 0
            ? ' We check each one, usually within one working day.'
            : ''),
    );
  }, [onAdded, tell]);

  // What Ozi hears goes here first while there is a list or the camera is on.
  useEffect(() => {
    const find = (name: string | null): Draft | undefined => {
      const list = live.current.drafts;
      if (name === null) return list[list.length - 1];
      const key = nameKey(name.replace(/^the /i, ''));
      return list.find((row) => nameKey(row.name).includes(key));
    };
    const handler = (text: string): boolean => {
      const command = understandScanVoice(text);
      if (!command) return false;
      if (command.kind === 'start') {
        if (!stream.current) void startRef.current();
        return true;
      }
      if (live.current.drafts.length === 0 && !stream.current) return false;
      switch (command.kind) {
        case 'stop':
          stop();
          tell('The camera is off.');
          return true;
        case 'read': {
          const list = live.current.drafts;
          tell(
            list.length === 0
              ? 'Nothing scanned yet.'
              : `${list.length} in the list: ${list
                  .map((row) => {
                    const pence = pencePrice(row.priceText);
                    return `${row.name || 'a product with no name'}, ${pence === null ? 'no price' : money(pence)}${row.priceEstimated ? ', estimate' : ''}`;
                  })
                  .join('; ')}. Say "add all" to send them to be checked.`,
          );
          return true;
        }
        case 'add-all': {
          const count = live.current.drafts.length;
          if (count === 0) return false;
          confirm(
            `Send ${count} product${count === 1 ? '' : 's'} to be checked? Say yes to confirm.`,
            (yes) => (yes ? void addAll() : tell('All right, they stay in the list.')),
          );
          return true;
        }
        case 'price': {
          const row = find(command.name);
          if (!row) return false;
          if (command.pricePence === null) {
            tell("I didn't catch the price.");
            return true;
          }
          change(row.key, { priceText: priceText(command.pricePence), priceEstimated: false });
          live.current.drafts = live.current.drafts.map((draft) =>
            draft.key === row.key
              ? { ...draft, priceText: priceText(command.pricePence), priceEstimated: false }
              : draft,
          );
          tell(`${row.name || 'That one'} is now ${money(command.pricePence)}.`);
          return true;
        }
        case 'rename': {
          const row = find(command.name);
          if (!row) return false;
          change(row.key, { name: command.to });
          live.current.drafts = live.current.drafts.map((draft) =>
            draft.key === row.key ? { ...draft, name: command.to } : draft,
          );
          tell(`Called it ${command.to}.`);
          return true;
        }
        case 'remove': {
          const row = find(command.name);
          if (!row) return false;
          remove(row.key);
          live.current.drafts = live.current.drafts.filter((draft) => draft.key !== row.key);
          tell(`Taken ${row.name || 'that one'} out of the list.`);
          return true;
        }
      }
    };
    registerVoice(handler);
    return () => registerVoice(null);
  }, [registerVoice, addAll, confirm, stop, tell]);

  const fileField = 'control w-full rounded-2xl border-2 border-paper bg-paper text-ink p-3';
  return (
    <section
      aria-labelledby="scan-heading"
      className="space-y-3 border-2 border-highlight rounded-2xl p-4"
    >
      <h2 id="scan-heading" className="text-lead font-bold m-0">
        Scan products
      </h2>
      <p className="m-0">
        Point the camera at a barcode or a shelf price label and hold it still: it captures by
        itself and says each product. One scan covers every identical pack. Check the list, then
        press Add all; nothing is added before that.
        {placesLeft !== null
          ? ` On a free listing you can add ${placesLeft} more product${placesLeft === 1 ? '' : 's'}.`
          : ''}
        {plus ? ' The picture becomes the product’s photo.' : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        {scanning ? (
          <button
            type="button"
            onClick={() => {
              stop();
              tell('The camera is off.');
            }}
            className="control bg-paper/10 text-paper border-paper"
          >
            <span aria-hidden="true">⏹️</span> Stop scanning
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            className="control bg-highlight text-on-accent"
          >
            <span aria-hidden="true">📷</span> Start scanning with the camera
          </button>
        )}
      </div>
      <video
        ref={video}
        muted
        playsInline
        aria-hidden="true"
        className={scanning ? 'w-full max-h-80 rounded-2xl bg-ink object-cover' : 'hidden'}
      />
      <p role="status" aria-live="polite" className="m-0 min-h-control">
        {news}
      </p>
      <label htmlFor="scan-take" className="block font-bold">
        Or take a photo of a label
      </label>
      <input
        id="scan-take"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => void fromFiles(event)}
        className={fileField}
      />
      <label htmlFor="scan-upload" className="block font-bold">
        Or upload photos of labels
      </label>
      <input
        id="scan-upload"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => void fromFiles(event)}
        className={fileField}
      />

      {drafts.length > 0 && (
        <section aria-labelledby="drafts-heading" className="space-y-3">
          <h3 id="drafts-heading" className="font-bold m-0">
            Found so far ({drafts.length}): check them, then Add all
          </h3>
          <ul className="list-none m-0 p-0 space-y-3">
            {drafts.map((draft, index) => {
              const label = draft.name || `Product ${index + 1}`;
              return (
                <li key={draft.key} className="border-2 border-paper/40 rounded-2xl p-3 space-y-2">
                  <h4 className="m-0 font-bold">{label}</h4>
                  {draft.photo && (
                    <img
                      src={`data:${draft.photo.contentType};base64,${draft.photo.base64}`}
                      alt={`${label}, as the camera saw it`}
                      className="max-h-32 rounded-xl"
                    />
                  )}
                  <label htmlFor={`${draft.key}-name`} className="block">
                    Name<span className="visually-hidden"> of {label}</span>
                  </label>
                  <input
                    id={`${draft.key}-name`}
                    value={draft.name}
                    onChange={(event) => change(draft.key, { name: event.target.value })}
                    className="control w-full rounded-2xl border-2 border-paper bg-paper text-ink p-3"
                  />
                  <label htmlFor={`${draft.key}-price`} className="block">
                    Price in pounds<span className="visually-hidden"> for {label}</span>
                  </label>
                  <input
                    id={`${draft.key}-price`}
                    inputMode="decimal"
                    value={draft.priceText}
                    onChange={(event) =>
                      change(draft.key, { priceText: event.target.value, priceEstimated: false })
                    }
                    className="control w-full rounded-2xl border-2 border-paper bg-paper text-ink p-3"
                  />
                  {draft.priceEstimated && (
                    <p className="m-0 font-bold">
                      <span aria-hidden="true">⚠️</span> Estimate, please check the price.
                    </p>
                  )}
                  {draft.barcode && <p className="m-0">Barcode {draft.barcode}.</p>}
                  {draft.problem && (
                    <p role="alert" className="m-0 font-bold">
                      {draft.problem}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(draft.key)}
                    className="control bg-paper/10 text-paper underline"
                  >
                    Remove<span className="visually-hidden"> {label} from the list</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={() => void addAll()}
            className="control w-full bg-highlight text-on-accent text-lead disabled:opacity-70"
          >
            {busy ? 'Sending…' : `Add all (${drafts.length}) to be checked`}
          </button>
        </section>
      )}
    </section>
  );
}
