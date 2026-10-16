import { useCallback, useEffect, useRef, useState } from 'react';

import { isUkMobileNumber } from '../lib/api';
import { pairsAloud } from '../lib/phone-aloud';
import { useOzi } from './ozi';

/**
 * Setting up an account by talking to Ozi (Anthony, 4 October 2026): "Somebody blind cannot
 * create accounts. That's the whole point." Ozi asks for each thing the form asks for, one at a
 * time, reads back the phone number and the address to be sure it heard them right, and only
 * creates the account after a yes.
 *
 * What is heard is written into the form as it goes, so somebody beside the Shopper can see it
 * and correct it, and so the form is ready if they would rather finish it by hand. "Stop" at
 * any point stops, and nothing is created.
 */

export interface SpokenDetails {
  displayName: string;
  phone: string;
  deliveryAddress: string;
  doorstepProtocol: string;
}

type Field = keyof SpokenDetails;

const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  o: '0',
  nought: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

/** A phone number as it was said, as digits: "oh seven seven double oh…" too. */
export function spokenDigits(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9+\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let out = '';
  let repeat = 1;
  for (const word of words) {
    if (word === 'double') {
      repeat = 2;
      continue;
    }
    if (word === 'triple') {
      repeat = 3;
      continue;
    }
    const digit = NUMBER_WORDS[word] ?? (/^\+?\d+$/.test(word) ? word : '');
    if (digit === '') continue;
    out += repeat > 1 ? digit.charAt(0).repeat(repeat) + digit.slice(1) : digit;
    repeat = 1;
  }
  return out.replace(/(?!^)\+/g, '');
}

/** "My name is margaret." → "Margaret". */
export function spokenName(text: string): string {
  const name = text
    .trim()
    .replace(/^(my name is|my name's|i am|i'm|it's|it is|call me|this is)\s+/i, '')
    .replace(/[.,!?]+$/, '')
    .trim();
  return name.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

export function yesOrNo(text: string): 'yes' | 'no' | null {
  const words = text.toLowerCase();
  if (/\b(no|nope|wrong|not right|incorrect)\b/.test(words)) return 'no';
  if (
    /\b(yes|yeah|yep|yup|correct|right|ok|okay|sure|go ahead|please do|that's it)\b/.test(words)
  ) {
    return 'yes';
  }
  return null;
}

const STOP = /\b(stop|cancel|never mind|forget it)\b/i;
const NOTHING = /^(nothing|no|none|skip|nothing thanks|no thanks|nothing special)\b/i;

/**
 * Confirming the number with a code (ruling 33), when the server asks for it: a text to a
 * mobile, or a phone call that says the code to a landline.
 */
export interface NumberConfirmation {
  /** Send the code; says how. Throws with the words to say if it cannot be sent. */
  send: (phone: string) => Promise<'text' | 'call'>;
  /** Check the code: true, or the words saying what was wrong. */
  check: (phone: string, code: string) => Promise<true | string>;
}

/** "Which part is wrong?": name, number, address or door, from whatever words were used. */
export function partToFix(text: string): Field | null {
  const words = text.toLowerCase();
  if (/\b(name|called|spell)\b/.test(words)) return 'displayName';
  if (/\b(number|phone|mobile|telephone|landline)\b/.test(words)) return 'phone';
  if (/\b(address|street|road|postcode|post code|house|flat|town)\b/.test(words)) {
    return 'deliveryAddress';
  }
  if (/\b(door|doorstep|runner|knock|instructions?)\b/.test(words)) return 'doorstepProtocol';
  return null;
}

export function useVoiceSignUp({
  fill,
  finish,
  confirmNumber,
  callsOn = false,
}: {
  /** Write what was heard into the form on the screen. */
  fill: (field: Field, value: string) => void;
  /** Everything is agreed: create the account. */
  finish: (details: SpokenDetails) => Promise<void>;
  /** Present once numbers are confirmed with a code at sign-up. */
  confirmNumber?: NumberConfirmation | undefined;
  /** Codes by phone call are switched on (the server's `signIn.byCall`), so a landline will do. */
  callsOn?: boolean;
}): { active: boolean; start: () => void } {
  const ozi = useOzi();
  const [active, setActive] = useState(false);
  const cancel = useRef<(() => void) | null>(null);
  const details = useRef<SpokenDetails>({
    displayName: '',
    phone: '',
    deliveryAddress: '',
    doorstepProtocol: '',
  });
  const live = useRef({ ozi, fill, finish, confirmNumber, callsOn });
  live.current = { ozi, fill, finish, confirmNumber, callsOn };

  // Leaving the page stops the questions, so nothing said later is taken as an answer.
  useEffect(
    () => () => {
      cancel.current?.();
    },
    [],
  );

  const start = useCallback(() => {
    const { ozi: o } = live.current;

    const ask = (prompt: string, then: (text: string) => void): void => {
      cancel.current = o.listenFor(prompt, (text) => {
        if (STOP.test(text)) {
          setActive(false);
          void live.current.ozi.say(
            "All right, I've stopped. Nothing has been created. The form is on the screen whenever you want it.",
          );
          return;
        }
        then(text);
      });
    };

    const confirm = (prompt: string, yes: () => void, no: () => void): void => {
      ask(prompt, (text) => {
        const answer = yesOrNo(text);
        if (answer === 'yes') yes();
        else if (answer === 'no') no();
        else confirm(`Please say yes or no. ${prompt}`, yes, no);
      });
    };

    const set = (field: Field, value: string): void => {
      details.current = { ...details.current, [field]: value };
      live.current.fill(field, value);
    };

    // After a "no" at the end, one question is asked again, and then the whole thing is read
    // back once more (16 October 2026).
    let correcting = false;
    const proceed = (next: () => void): void => {
      if (correcting) {
        correcting = false;
        askFinal();
      } else {
        next();
      }
    };

    const phoneQuestion = (): string =>
      live.current.callsOn
        ? "What's your phone number? A mobile or a landline."
        : "What's your mobile number?";

    const askName = (prompt: string): void =>
      ask(prompt, (text) => {
        const name = spokenName(text);
        if (name === '') {
          askName("Sorry, I didn't catch your name. What would you like us to call you?");
          return;
        }
        set('displayName', name);
        proceed(() => askPhone(`Thank you, ${name}. ${phoneQuestion()}`));
      });

    const askPhone = (prompt: string): void =>
      ask(prompt, (text) => {
        const digits = spokenDigits(text);
        if (digits.replace(/^\+/, '').length < 10 || digits.length > 14) {
          askPhone(
            "I didn't catch a whole phone number. Please say it again, one number at a time.",
          );
          return;
        }
        // With calls off, a landline cannot be sent its code: only a mobile is asked for.
        if (live.current.confirmNumber && !live.current.callsOn && !isUkMobileNumber(digits)) {
          askPhone(
            'That sounds like a landline. For now we can only send a code to a mobile, so please say a mobile number, starting zero seven.',
          );
          return;
        }
        confirm(
          `I heard ${pairsAloud(digits)}. Is that right?`,
          () => {
            set('phone', digits);
            if (live.current.confirmNumber) {
              void sendCode(digits);
              return;
            }
            proceed(() =>
              askAddress(
                'Where should we bring your shopping? Please say the full address, with the door number and the postcode.',
              ),
            );
          },
          () => askPhone('All right. Please say your phone number again.'),
        );
      });

    const sendCode = async (phone: string): Promise<void> => {
      const confirmation = live.current.confirmNumber;
      if (!confirmation) return;
      try {
        const how = await confirmation.send(phone);
        askCode(
          how === 'call'
            ? "To check it's your number, I'm phoning it now. Answer, and a voice will read you a code. Then tell me the numbers of the code, one at a time."
            : "To check it's your number, I've sent a code to it by text. When it arrives, tell me the numbers of the code, one at a time. Or say send it again.",
          phone,
          0,
        );
      } catch (failure) {
        setActive(false);
        void live.current.ozi.say(
          `${failure instanceof Error ? failure.message : "I couldn't send a code just now."} What I heard is in the form on the screen.`,
        );
      }
    };

    const askCode = (prompt: string, phone: string, tries: number): void =>
      ask(prompt, (text) => {
        if (/\b(again|resend|didn'?t (get|come)|not (come|arrived)|call me)\b/i.test(text)) {
          void sendCode(phone);
          return;
        }
        const code = spokenDigits(text);
        if (code.length < 4) {
          askCode("I didn't hear the code. Please say its numbers, one at a time.", phone, tries);
          return;
        }
        void live.current.confirmNumber?.check(phone, code).then((result) => {
          if (result === true) {
            proceed(() =>
              askAddress(
                'Thank you, your number is confirmed. Where should we bring your shopping? Please say the full address, with the door number and the postcode.',
              ),
            );
          } else if (tries >= 2) {
            setActive(false);
            void live.current.ozi.say(
              `${result} I've stopped for now. To try again, say create my account.`,
            );
          } else {
            askCode(`${result} Please say the code again.`, phone, tries + 1);
          }
        });
      });

    const askAddress = (prompt: string): void =>
      ask(prompt, (text) => {
        const address = text.trim().replace(/[.]+$/, '');
        confirm(
          `I heard: ${address}. Is that right?`,
          () => {
            set('deliveryAddress', address);
            proceed(askDoor);
          },
          () => askAddress('All right. Please say the address again, with the postcode.'),
        );
      });

    const askDoor = (): void =>
      ask(
        'What should your Runner do at the door? For example: knock loudly and wait. Or say nothing. Anything you tell me about your health is only used to help you at the door.',
        (text) => {
          set('doorstepProtocol', NOTHING.test(text.trim()) ? '' : text.trim());
          askFinal();
        },
      );

    const askWhichPart = (prompt: string): void =>
      ask(prompt, (text) => {
        const part = partToFix(text);
        if (part === null) {
          if (/\b(nothing|none|all right|it'?s fine|fine|leave it)\b/i.test(text)) {
            askFinal();
            return;
          }
          askWhichPart('Please say name, number, address or door.');
          return;
        }
        correcting = true;
        if (part === 'displayName') askName("All right. What's your name?");
        else if (part === 'phone') askPhone(`All right. ${phoneQuestion()}`);
        else if (part === 'deliveryAddress') {
          askAddress(
            'All right. Please say the full address, with the door number and the postcode.',
          );
        } else askDoor();
      });

    const askFinal = (): void => {
      const d = details.current;
      confirm(
        `That's everything. You are ${d.displayName}, your phone number is ${pairsAloud(d.phone)}, and your shopping comes to ${d.deliveryAddress}. Shall I create your account now?`,
        () => {
          setActive(false);
          cancel.current = null;
          void live.current.finish(details.current);
        },
        () => {
          askWhichPart(
            "All right, I haven't created anything. Which part is wrong: name, number, address or door?",
          );
        },
      );
    };

    cancel.current?.();
    setActive(true);
    askName(
      "Let's set up your account together, by talking. There's no password. If you want to stop at any time, say stop. First, what's your name? A first name is plenty.",
    );
  }, []);

  return { active, start };
}
