import { organisationConsentWords } from '@aldilivery/core';

import { storeConfig } from '../config';
import { money } from '../lib/money';

/**
 * What a person agrees to before linking their account to an organisation (Anthony, 30 October
 * 2026; UK GDPR): exactly what the organisation will see, that it pays its own fee for them and
 * their delivery becomes the Membership price, and who may agree. The words, and their version
 * the server keeps, come from packages/core; every price from config/store.json.
 */
export function OrganisationConsent({
  organisation = 'the organisation',
  agreed,
  onAgreed,
  id = 'organisation-consent',
}: {
  organisation?: string;
  agreed: boolean;
  onAgreed: (agreed: boolean) => void;
  id?: string;
}): JSX.Element {
  const words = organisationConsentWords(
    organisation,
    storeConfig.extras.organisations,
    storeConfig.fees,
    money,
  );
  return (
    <div className="space-y-3">
      <p className="m-0">{words.intro}</p>
      <ul className="m-0 ps-6 space-y-1">
        {words.shared.map((thing) => (
          <li key={thing}>{thing}</li>
        ))}
      </ul>
      <p className="m-0">{words.notShared}</p>
      <p className="m-0">{words.fee}</p>
      <p className="m-0">{words.delivery}</p>
      <p className="m-0 font-bold">{words.authority}</p>
      <div className="flex items-center gap-3 min-h-control">
        <input
          type="checkbox"
          id={id}
          checked={agreed}
          onChange={(event) => onAgreed(event.target.checked)}
          className="w-6 h-6 shrink-0"
        />
        <label htmlFor={id} className="m-0">
          {words.tick}
        </label>
      </div>
    </div>
  );
}
