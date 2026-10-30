import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { storeConfig } from '../config';
import { checkPartnerAgreement } from '../lib/api';

/**
 * Where the QR code on a printed Shop Partner agreement sheet leads (Anthony, 30 October 2026):
 * whether an agreement with that reference really exists, for which business, and whether it is
 * waiting for approval or approved. Nothing personal is shown. A copied or forged sheet either
 * shows a different business or no agreement at all, and staff check the reference before they
 * approve, so a sheet creates nothing on its own.
 */
export function PartnerAgreementCheck(): JSX.Element {
  const { reference = '' } = useParams();
  const [found, setFound] = useState<Awaited<ReturnType<typeof checkPartnerAgreement>> | null>(
    null,
  );
  const [problem, setProblem] = useState('');

  useEffect(() => {
    checkPartnerAgreement(reference)
      .then(setFound)
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That could not be checked.'),
      );
  }, [reference]);

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-display font-bold m-0">
        Shop Partner agreement {reference.toUpperCase()}
      </h1>
      {problem !== '' && (
        <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-2xl">
          {problem}
        </p>
      )}
      {found && !found.found && (
        <p className="m-0">
          There is no agreement with this reference. If somebody gave you this sheet, please ring us
          on {storeConfig.contact.telephonePlaceholder}.
        </p>
      )}
      {found?.found && (
        <>
          <p className="m-0 font-bold">This is a real agreement, for {found.business}.</p>
          <p className="m-0">{found.statusWords}</p>
        </>
      )}
    </div>
  );
}
