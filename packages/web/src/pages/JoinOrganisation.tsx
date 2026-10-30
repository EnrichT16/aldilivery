import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { OrganisationConsent } from '../components/OrganisationConsent';
import { storeConfig } from '../config';
import { joinOrganisation, rememberJoinedVia } from '../lib/api';
import { useSession } from '../state/session';

/**
 * An organisation's share link (7 October 2026): /join/organisation/<code>. Someone already
 * with an account links to it here, after agreeing what it will see; someone new opens an
 * account first, and the link is counted for the organisation. Since 30 October 2026 the words
 * say exactly what is shared, from then on only, and who may agree (UK GDPR).
 */
export function JoinOrganisation(): JSX.Element {
  const { code = '' } = useParams();
  const { shopper, restoring } = useSession();
  const [agreed, setAgreed] = useState(false);
  const [news, setNews] = useState('');
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!restoring && !shopper && /^[A-Za-z0-9]{4,12}$/.test(code)) {
      rememberJoinedVia(`organisation:${code.toUpperCase()}`);
    }
  }, [code, shopper, restoring]);

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-display font-bold m-0">Link to an organisation</h1>
      <p className="m-0">
        An organisation that supports you, such as a care home or the council, shared this link.
        Linking your {storeConfig.productName} account lets them help with your shopping.
      </p>
      <p role="status" className="m-0">
        {news}
      </p>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-2xl m-0">
          {problem}
        </p>
      )}
      {restoring ? null : !shopper ? (
        <>
          <p className="m-0">First, open your account. Then come back to this link to finish.</p>
          <Link to="/sign-up" className="control bg-highlight text-on-accent">
            Open my account
          </Link>
        </>
      ) : news === '' ? (
        <>
          <OrganisationConsent agreed={agreed} onAgreed={setAgreed} />
          <button
            type="button"
            disabled={!agreed}
            onClick={() =>
              void joinOrganisation(code)
                .then((result) => setNews(result.message))
                .catch((failure: unknown) =>
                  setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
                )
            }
            className="control bg-highlight text-on-accent disabled:opacity-70"
          >
            Link my account
          </button>
        </>
      ) : null}
    </div>
  );
}
