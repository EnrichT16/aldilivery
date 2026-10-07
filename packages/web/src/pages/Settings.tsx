import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
import { ShareCard } from '../components/ShareCard';
import { ShowWordsSwitch } from '../components/ShowWordsSwitch';
import {
  fetchMyOrganisation,
  fetchMyShareLink,
  joinOrganisation,
  leaveOrganisation,
  updateMe,
} from '../lib/api';
import { useSession } from '../state/session';
import { useVoice } from '../state/voice';
import type { OutputVoice, VoiceReadiness } from '../voice';

/**
 * Settings: your addresses, and Ozi's voice.
 *
 * Ozi speaks aloud unless this says otherwise (docs/BUILD_PROMPT.md, Section E). The switch is
 * here for sighted Shoppers who would rather read; it is found, not offered.
 *
 * The voice choice sits here too: two or three output voices per language, so a Nigerian
 * Shopper can choose Nigerian English over received pronunciation. With the stand-in engine
 * the voices are whatever this phone has; Oluoma Voice will bring its own. Choosing one says a
 * sentence in it, so the choice is made by ear.
 */
export function Settings(): JSX.Element {
  const voice = useVoice();
  const { shopper, signOut } = useSession();
  const { settings } = voice;
  const assistant = storeConfig.assistantName;
  const [voices, setVoices] = useState<OutputVoice[] | null>(null);
  const [readiness, setReadiness] = useState<VoiceReadiness | null>(null);
  const [news, setNews] = useState('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      voice.engine.voices(settings.language),
      voice.engine.readiness(settings.language),
    ]).then(([found, ready]) => {
      if (cancelled) return;
      setVoices(found);
      setReadiness(ready);
    });
    return () => {
      cancelled = true;
    };
  }, [voice.engine, settings.language]);

  const chosen = settings.voiceIds[settings.language] ?? '';

  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">Settings</h1>

      <p role="status" className="m-0 min-h-control">
        {news}
      </p>

      <section aria-labelledby="screen-heading" className="space-y-3 max-w-xl">
        <h2 id="screen-heading" className="text-lead font-bold">
          The screen
        </h2>
        <ShowWordsSwitch />
      </section>

      <section aria-labelledby="addresses-heading" className="space-y-3 max-w-xl">
        <h2 id="addresses-heading" className="text-lead font-bold">
          Addresses
        </h2>
        <p className="m-0 extra">
          Your home address, and any others you send shopping to. Changing them needs your PIN.
        </p>
        <Link to="/addresses" className="control bg-paper text-ink">
          Your addresses
        </Link>
      </section>

      <section aria-labelledby="voice-heading" className="space-y-4 max-w-xl">
        <h2 id="voice-heading" className="text-lead font-bold">
          {assistant}&rsquo;s voice
        </h2>

        <div className="flex items-start gap-3">
          <input
            id="speaks-aloud"
            type="checkbox"
            checked={!settings.muted}
            aria-describedby="speaks-aloud-hint"
            onChange={(event) => {
              const speaks = event.target.checked;
              voice.update({ muted: !speaks });
              setNews(
                speaks
                  ? `${assistant} will speak aloud.`
                  : `${assistant} will stay quiet. Everything ${assistant} says is still written on the screen.`,
              );
            }}
            className="h-8 w-8 mt-1 shrink-0"
          />
          <div>
            <label htmlFor="speaks-aloud" className="font-bold text-lead">
              {assistant} speaks aloud
            </label>
            <p id="speaks-aloud-hint" className="m-0 extra">
              On unless you turn it off. Everything {assistant} says is always written on the screen
              as well.
            </p>
          </div>
        </div>

        <fieldset className="border-2 border-paper/40 rounded-xl p-4 m-0 space-y-2">
          <legend className="px-2 font-bold">Which voice</legend>
          {voices === null ? (
            <p className="m-0">Finding the voices on this phone.</p>
          ) : (
            [
              { id: '', name: 'The usual voice on this phone', language: settings.language },
              ...voices,
            ].map((option) => (
              <div key={option.id || 'default'} className="flex items-center gap-3 min-h-control">
                <input
                  id={`voice-${option.id || 'default'}`}
                  type="radio"
                  name="voice"
                  value={option.id}
                  checked={chosen === option.id}
                  onChange={() => {
                    const voiceIds = { ...settings.voiceIds };
                    if (option.id === '') delete voiceIds[settings.language];
                    else voiceIds[settings.language] = option.id;
                    voice.update({ voiceIds });
                    void voice.engine.speak(`This is how ${assistant} will sound.`, {
                      language: settings.language,
                      ...(option.id ? { voiceId: option.id } : {}),
                    });
                  }}
                  className="h-7 w-7 shrink-0"
                />
                <label htmlFor={`voice-${option.id || 'default'}`}>{option.name}</label>
              </div>
            ))
          )}
        </fieldset>

        {readiness && !readiness.canListen && (
          <p className="m-0">
            {readiness.reason ?? 'This phone or browser cannot listen.'} {assistant} can still
            speak.
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            voice.update({ bubble: null });
            setNews(`${assistant}’s button is back in its usual place, on the right.`);
          }}
          className="control bg-paper text-ink"
        >
          Put {assistant}&rsquo;s button back in its usual place
        </button>
        <p className="m-0 text-paper/80 extra">Speech by: {voice.engine.name}.</p>
      </section>

      {shopper && <ShareCard load={fetchMyShareLink} onNews={setNews} />}

      {shopper && <OrganisationLink />}

      {shopper && <AgeGroup />}

      {shopper && (
        // A shared phone (Anthony, 4 October 2026). By voice: "sign me out", "change account".
        <section aria-labelledby="account-heading" className="space-y-3 max-w-xl">
          <h2 id="account-heading" className="text-lead font-bold">
            This phone
          </h2>
          <p className="m-0">
            Signed in as {shopper.displayName}. Sharing this phone? Sign out, and the next person
            can sign in or open their own account.
          </p>
          <button
            type="button"
            onClick={() => {
              signOut();
              setNews('Signed out. To sign in again, or open an account, just tell me.');
            }}
            className="control bg-paper text-ink"
          >
            Sign out
          </button>
        </section>
      )}
    </div>
  );
}

/**
 * Letting an organisation that supports you, such as a care home or the council, see your
 * orders (7 October 2026). Only the person does this, with the organisation's code, after being
 * told what it means; and they can stop it here at any time.
 */
function OrganisationLink(): JSX.Element {
  const [linked, setLinked] = useState<{ name: string } | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');

  useEffect(() => {
    fetchMyOrganisation()
      .then((result) => setLinked(result.organisation))
      .catch(() => undefined);
  }, []);

  return (
    <section aria-labelledby="organisation-heading" className="space-y-3 max-w-xl">
      <h2 id="organisation-heading" className="text-lead font-bold">
        An organisation that supports you
      </h2>
      <p role="status" className="m-0">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      {linked ? (
        <>
          <p className="m-0">{linked.name} can see your orders and what they cost.</p>
          <button
            type="button"
            onClick={() =>
              void leaveOrganisation().then((result) => {
                setLinked(null);
                setNews(result.message);
              })
            }
            className="control bg-paper text-ink"
          >
            Stop {linked.name} seeing my orders
          </button>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const code = String(new FormData(event.currentTarget).get('organisation-code') ?? '');
            setProblem('');
            joinOrganisation(code)
              .then((result) => {
                setLinked(result.organisation);
                setNews(result.message);
              })
              .catch((failure: unknown) =>
                setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
              );
          }}
          className="space-y-3"
        >
          <p className="m-0 extra">
            If a care home, the council or another organisation helps you with your shopping, they
            may give you a code. Typing it here lets them see your orders and what they cost.
          </p>
          <label htmlFor="organisation-code" className="block font-bold">
            The organisation’s code
          </label>
          <input
            id="organisation-code"
            name="organisation-code"
            autoComplete="off"
            className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3 uppercase"
          />
          <label className="flex items-center gap-3 min-h-control">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="w-6 h-6"
            />
            I agree that they will see my orders and what they cost.
          </label>
          <button
            type="submit"
            disabled={!agreed}
            className="control bg-paper text-ink disabled:opacity-70"
          >
            Link my account
          </button>
        </form>
      )}
    </section>
  );
}

const AGE_GROUPS: Array<{ value: '' | 'under_25' | '25_44' | '45_64' | '65_plus'; label: string }> =
  [
    { value: '', label: 'I would rather not say' },
    { value: 'under_25', label: 'Under 25' },
    { value: '25_44', label: '25 to 44' },
    { value: '45_64', label: '45 to 64' },
    { value: '65_plus', label: '65 and over' },
  ];

/**
 * An age group, if the person wants to give one (7 October 2026): used only, with no names, to
 * understand what different groups need, and always taken away again here.
 */
function AgeGroup(): JSX.Element {
  const { shopper, replaceShopper } = useSession();
  const [news, setNews] = useState('');
  const current = shopper?.ageBand ?? '';
  return (
    <section aria-labelledby="age-heading" className="space-y-3 max-w-xl">
      <h2 id="age-heading" className="text-lead font-bold">
        Your age group (optional)
      </h2>
      <p className="m-0 extra">
        It helps us understand what different people need. It is never shown to anyone, never sold
        with your name, and you can take it away here at any time.
      </p>
      <label htmlFor="age-group" className="block font-bold">
        Age group
      </label>
      <select
        id="age-group"
        value={current}
        onChange={(event) => {
          const value = event.target.value as (typeof AGE_GROUPS)[number]['value'];
          void updateMe({ ageBand: value === '' ? null : value }).then((result) => {
            replaceShopper(result.shopper);
            setNews(value === '' ? 'Taken away.' : 'Saved. Thank you.');
          });
        }}
        className="w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3"
      >
        {AGE_GROUPS.map((group) => (
          <option key={group.value} value={group.value}>
            {group.label}
          </option>
        ))}
      </select>
      <p role="status" className="m-0">
        {news}
      </p>
    </section>
  );
}
