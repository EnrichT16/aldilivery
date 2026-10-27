/**
 * Two ways to give a picture: take it now with the camera, or choose one already on the phone or
 * computer (27 October 2026). `capture` sends the first straight to the camera, which is the
 * fewest steps for somebody who cannot see the screen; the second has no `capture`, so the phone
 * offers its photo library and files as well.
 *
 * Each is a real file input inside its label, styled as a button, with the focus ring on the
 * label when the input has focus.
 */

import { useId } from 'react';

const RING =
  'cursor-pointer focus-within:outline focus-within:outline-4 focus-within:outline-offset-2';

export function PhotoChoice({
  takeLabel,
  chooseLabel = 'Choose a photo',
  camera = 'environment',
  accept = 'image/*',
  disabled = false,
  describedBy,
  takeClassName = 'control bg-highlight text-on-accent',
  chooseClassName = 'control border-paper bg-paper/10 text-paper',
  onFile,
}: {
  takeLabel: string;
  chooseLabel?: string;
  /** Which camera: the back one for documents and receipts, the front one for a face. */
  camera?: 'environment' | 'user';
  /** What may be chosen. Taking a photo is always a photo. */
  accept?: string;
  disabled?: boolean;
  describedBy?: string;
  takeClassName?: string;
  chooseClassName?: string;
  onFile: (file: File) => void;
}): JSX.Element {
  const id = useId();
  const picked = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onFile(file);
  };
  const dim = disabled ? 'opacity-70' : '';

  return (
    <div className="flex flex-wrap gap-2">
      <label className={`${takeClassName} ${RING} ${dim}`}>
        {takeLabel}
        <input
          id={`${id}-take`}
          type="file"
          accept="image/*"
          capture={camera}
          aria-describedby={describedBy}
          disabled={disabled}
          onChange={picked}
          className="visually-hidden"
        />
      </label>
      <label className={`${chooseClassName} ${RING} ${dim}`}>
        {chooseLabel}
        <input
          id={`${id}-choose`}
          type="file"
          accept={accept}
          aria-describedby={describedBy}
          disabled={disabled}
          onChange={picked}
          className="visually-hidden"
        />
      </label>
    </div>
  );
}
