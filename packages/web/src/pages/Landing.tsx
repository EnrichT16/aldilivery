import { DoorButton } from '../components/DoorButton';
import { MicrophoneButton } from '../components/MicrophoneButton';
import { storeConfig } from '../config';

/**
 * The landing page.
 *
 * Deep navy, one large gold microphone in the middle, white text, and three doors. Nothing
 * else. Someone who can barely see the screen should be able to find the gold circle, and
 * someone who cannot see it at all should hear four things and no more.
 */
export function Landing(): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-10 py-4">
      <h1 className="text-display font-bold text-center m-0">{storeConfig.productName}</h1>

      <p className="text-lead text-center m-0 max-w-xl">{storeConfig.tagline}</p>

      <MicrophoneButton />

      <section aria-labelledby="doors-heading" className="w-full max-w-xl">
        <h2 id="doors-heading" className="text-lead font-bold">
          Or choose where you would like to go
        </h2>
        <ul className="list-none m-0 p-0 space-y-4">
          <li>
            <DoorButton
              to="/sign-up"
              title="Shopper"
              description="I want my shopping brought to me."
            />
          </li>
          <li>
            <DoorButton
              to="/runner"
              title="Runner"
              description="I want to shop and deliver, and be paid for it."
            />
          </li>
          <li>
            <DoorButton
              to="/just-looking"
              title="Just looking"
              description="Tell me how this works before I decide."
            />
          </li>
        </ul>
      </section>

      <section aria-labelledby="telephone-heading" className="w-full max-w-xl text-center">
        <h2 id="telephone-heading" className="text-lead font-bold">
          Would you rather telephone us?
        </h2>
        <p className="m-0">Ring us and a person will take your order.</p>
        <p className="m-0 mt-3">
          <a
            href={`tel:${storeConfig.contact.telephonePlaceholder.replace(/\s/g, '')}`}
            className="control bg-paper text-ink text-lead"
          >
            {storeConfig.contact.telephonePlaceholder}
          </a>
        </p>
        {storeConfig.contact.telephoneIsPlaceholder && (
          <p className="m-0 text-paper/80">
            This number is a placeholder while we get the line set up. It will not connect yet.
          </p>
        )}
      </section>
    </div>
  );
}
