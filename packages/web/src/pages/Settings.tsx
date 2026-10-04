import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { storeConfig } from '../config';
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

      <section aria-labelledby="addresses-heading" className="space-y-3 max-w-xl">
        <h2 id="addresses-heading" className="text-lead font-bold">
          Addresses
        </h2>
        <p className="m-0">
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
            <p id="speaks-aloud-hint" className="m-0">
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
        <p className="m-0 text-paper/80">Speech by: {voice.engine.name}.</p>
      </section>

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
