import { choosePin, pinNeeded } from '../lib/api';
import { PinEntry } from './PinEntry';

/**
 * Something that needs the PIN: saving an address, changing the home address.
 *
 * With no PIN yet, the Shopper chooses one here, the first time it is needed and not at sign
 * up (docs/BUILD_PROMPT.md, Section D), and the same PIN then does the thing they came to do.
 * Once a PIN is chosen it stays chosen, even if the thing itself is then refused, so the next
 * try asks for it rather than asking for a new one.
 */
export function PinGate({
  hasPin,
  setHasPin,
  purpose,
  action,
  onCancel,
}: {
  hasPin: boolean;
  setHasPin: (hasPin: boolean) => void;
  purpose: string;
  action: (pin: string) => Promise<void>;
  onCancel?: () => void;
}): JSX.Element {
  async function onPin(pin: string): Promise<void> {
    if (!hasPin) {
      await choosePin(pin);
      setHasPin(true);
    }
    try {
      await action(pin);
    } catch (failure) {
      // The server knows best: it had no PIN after all. Ask for one to be chosen.
      if (pinNeeded(failure)) {
        setHasPin(false);
        throw new Error('You have not chosen a PIN yet. Please choose one now.');
      }
      throw failure;
    }
  }

  return (
    <PinEntry
      mode={hasPin ? 'enter' : 'choose'}
      purpose={purpose}
      onPin={onPin}
      {...(onCancel ? { onCancel } : {})}
    />
  );
}
