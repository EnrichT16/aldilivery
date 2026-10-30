import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { FLYER_BASE_CSS, FLYERS } from '../components/ambassador/Flyers';
import { PrintSheet } from '../components/ambassador/PrintSheet';
import { shareLink } from '../components/ambassador/Toolkit';
import { QrCode } from '../components/QrCode';
import { storeConfig } from '../config';
import {
  fetchAgreementSheet,
  fetchAmbassadorToolkit,
  type AgreementSheet,
  type AmbassadorToolkit,
} from '../lib/api';
import { ambassadorAs } from '../lib/ambassador';

/**
 * The Toolkit's printed things (Anthony, 30 October 2026), each made here with the Ambassador's
 * own QR code, so they can only be printed from the app:
 *
 * - `/ambassador/print/flyer/<shoppers|carers|business|runners>`: an A5 flyer.
 * - `/ambassador/print/card/<shop>` and `/ambassador/print/sticker/<shop>`: "Order from us on
 *   <product>" with a QR code to that shop's page, for a business they introduced.
 * - `/ambassador/print/agreement/<reference>`: the Shop Partner agreement sheet of a business they
 *   signed up, with its unique reference and its own QR code, watermarked with the Ambassador's
 *   name and the date, stating the agreed mark-up and discount. The reference is checked by staff
 *   when they approve the business, so a copy or a forged sheet creates nothing on its own.
 */
export function AmbassadorPrint(): JSX.Element {
  const { kind = '', id = '' } = useParams();
  const [params] = useSearchParams();
  const as = ambassadorAs(params.get('as'));
  const [toolkit, setToolkit] = useState<AmbassadorToolkit | null>(null);
  const [sheet, setSheet] = useState<AgreementSheet | null>(null);
  const [problem, setProblem] = useState('');
  const [news, setNews] = useState('');

  useEffect(() => {
    if (!as) {
      setProblem('Please sign in to use your Ambassador Toolkit.');
      return;
    }
    const fail = (failure: unknown): void =>
      setProblem(failure instanceof Error ? failure.message : 'That could not be opened.');
    fetchAmbassadorToolkit(as).then(setToolkit).catch(fail);
    if (kind === 'agreement') fetchAgreementSheet(as, id).then(setSheet).catch(fail);
  }, [as, kind, id]);

  if (problem !== '' || !toolkit || (kind === 'agreement' && !sheet)) {
    return (
      <div className="space-y-4">
        <h1 className="text-display font-bold m-0">Ambassador Toolkit</h1>
        {problem !== '' ? (
          <p role="alert" className="m-0 border-2 border-paper bg-paper text-ink p-4 rounded-2xl">
            {problem}
          </p>
        ) : (
          <p className="m-0">Making it now.</p>
        )}
        <Link
          to="/ambassador/home?tab=toolkit"
          className="control border-paper bg-paper/10 text-paper"
        >
          Back to the Toolkit
        </Link>
      </div>
    );
  }

  if (kind === 'flyer') {
    const flyer = FLYERS.find((one) => one.key === id);
    if (!flyer) return <Missing />;
    const link = flyer.link(toolkit);
    return (
      <PrintSheet
        title={`${flyer.title} flyer`}
        pageSize="A5"
        extra={
          <>
            <button
              type="button"
              onClick={() => void shareLink(link, flyer.shareText, setNews)}
              className="control border-paper bg-paper/10 text-paper"
            >
              Share
            </button>
            <p role="status" className="m-0 w-full">
              {news}
            </p>
          </>
        }
      >
        <style>{FLYER_BASE_CSS}</style>
        <flyer.Flyer toolkit={toolkit} />
      </PrintSheet>
    );
  }

  if (kind === 'card' || kind === 'sticker') {
    const business = toolkit.businesses.find((one) => one.id === id && one.approved);
    if (!business) return <Missing />;
    return (
      <PrintSheet
        title={`${kind === 'card' ? 'Counter card' : 'Window sticker'} for ${business.name}`}
        pageSize={kind === 'card' ? 'A6' : '120mm 120mm'}
      >
        <OrderFromUs name={business.name} link={business.shopLink} kind={kind} />
      </PrintSheet>
    );
  }

  if (kind === 'agreement' && sheet) {
    return (
      <PrintSheet title={`Shop Partner agreement for ${sheet.business}`} pageSize="A4">
        <AgreementPaper sheet={sheet} printedBy={toolkit.name} />
      </PrintSheet>
    );
  }
  return <Missing />;
}

function Missing(): JSX.Element {
  return (
    <div className="space-y-4">
      <h1 className="text-display font-bold m-0">That is not in your Toolkit</h1>
      <Link
        to="/ambassador/home?tab=toolkit"
        className="control border-paper bg-paper/10 text-paper"
      >
        Back to the Toolkit
      </Link>
    </div>
  );
}

/** "Order from us on <product>": a counter card (A6) or a window sticker, with the shop's QR. */
export function OrderFromUs({
  name,
  link,
  kind,
}: {
  name: string;
  link: string;
  kind: 'card' | 'sticker';
}): JSX.Element {
  const navy = storeConfig.brand.colours.navy;
  const gold = storeConfig.brand.colours.gold;
  const size =
    kind === 'card' ? { width: '105mm', height: '148mm' } : { width: '120mm', height: '120mm' };
  return (
    <div
      style={{
        ...size,
        background: navy,
        color: '#FFFFFF',
        borderRadius: kind === 'sticker' ? '60mm' : '4mm',
        padding: kind === 'sticker' ? '16mm' : '10mm',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: '3mm',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
      }}
    >
      <p
        style={{
          margin: 0,
          fontWeight: 900,
          fontSize: kind === 'card' ? '9mm' : '7mm',
          lineHeight: 1.05,
        }}
      >
        Order from us on <span style={{ color: gold }}>{storeConfig.productName}</span>
      </p>
      <p style={{ margin: 0, fontSize: '4mm', fontWeight: 700 }}>{name}</p>
      <div
        style={{
          width: kind === 'card' ? '55mm' : '45mm',
          height: kind === 'card' ? '55mm' : '45mm',
          background: '#FFFFFF',
          padding: '2mm',
          borderRadius: '3mm',
        }}
      >
        <QrCode
          value={link}
          label={`QR code: ${name} on ${storeConfig.productName}`}
          dark={navy}
          className="w-full h-full"
        />
      </div>
      <p style={{ margin: 0, fontSize: '3.6mm', fontWeight: 700 }}>
        Scan to order, or ring {storeConfig.contact.telephonePlaceholder}
      </p>
    </div>
  );
}

function longDate(at: string | null): string {
  return (at ? new Date(at) : new Date()).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * The Shop Partner agreement sheet (30 October 2026): the business, the owner who agreed, the
 * agreed mark-up and discount, its unique reference and QR code, watermarked with the Ambassador
 * and the day it was printed. It records what was agreed in the app; it creates nothing itself.
 */
export function AgreementPaper({
  sheet,
  printedBy,
}: {
  sheet: AgreementSheet;
  printedBy: string;
}): JSX.Element {
  const product = storeConfig.productName;
  const navy = storeConfig.brand.colours.navy;
  const watermark = `Printed by Ambassador ${printedBy} on ${longDate(null)}`;
  return (
    <div
      className="agreement-paper"
      style={{
        width: '210mm',
        minHeight: '297mm',
        background: '#FFFFFF',
        color: navy,
        padding: '18mm',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
        fontSize: '4mm',
        lineHeight: 1.45,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-around',
          alignItems: 'center',
          transform: 'rotate(-30deg)',
          opacity: 0.08,
          fontSize: '9mm',
          fontWeight: 900,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {[0, 1, 2, 3, 4].map((line) => (
          <span key={line}>{watermark}</span>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <p style={{ margin: 0, fontWeight: 900, fontSize: '7mm' }}>{product}</p>
        <p style={{ margin: '2mm 0 6mm', fontWeight: 800, fontSize: '6mm' }}>
          Shop Partner agreement
        </p>
        <div style={{ display: 'flex', gap: '8mm', alignItems: 'flex-start' }}>
          <dl
            style={{
              margin: 0,
              flex: 1,
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '1.5mm 4mm',
            }}
          >
            <dt style={{ fontWeight: 800 }}>Reference</dt>
            <dd style={{ margin: 0 }}>{sheet.reference}</dd>
            <dt style={{ fontWeight: 800 }}>Business</dt>
            <dd style={{ margin: 0 }}>
              {sheet.business} ({sheet.kindWords})
            </dd>
            <dt style={{ fontWeight: 800 }}>Address</dt>
            <dd style={{ margin: 0 }}>
              {sheet.address}, {sheet.postcode}
            </dd>
            <dt style={{ fontWeight: 800 }}>Owner or manager</dt>
            <dd style={{ margin: 0 }}>{sheet.ownerName}</dd>
            <dt style={{ fontWeight: 800 }}>Agreed on</dt>
            <dd style={{ margin: 0 }}>{longDate(sheet.agreedAt)}</dd>
            <dt style={{ fontWeight: 800 }}>Agreed mark-up</dt>
            <dd style={{ margin: 0 }}>{sheet.markupPercent}%</dd>
            <dt style={{ fontWeight: 800 }}>Agreed discount</dt>
            <dd style={{ margin: 0 }}>
              {sheet.discountPercent > 0 ? `${sheet.discountPercent}%` : 'None'}
            </dd>
            <dt style={{ fontWeight: 800 }}>Introduced by</dt>
            <dd style={{ margin: 0 }}>Ozi Ambassador {sheet.ambassadorName}</dd>
          </dl>
          <div style={{ width: '38mm', flex: 'none', textAlign: 'center' }}>
            <QrCode
              value={sheet.checkLink}
              label={`QR code: check agreement ${sheet.reference}`}
              dark={navy}
              className="w-full"
            />
            <p style={{ margin: '1mm 0 0', fontSize: '3mm' }}>Scan to check this agreement</p>
          </div>
        </div>
        <p style={{ margin: '8mm 0 0' }}>
          The owner or manager named above read the Shop Partner terms (version{' '}
          {sheet.termsVersion ?? 'current'}) in the {product} app and agreed, typing their name. The
          mark-up and discount above were agreed with them. They are proposed until {product} staff
          confirm them, when they check this reference and approve the business.
        </p>
        <p style={{ margin: '4mm 0 0' }}>
          Nobody needs to pay anything to join. An Ambassador never collects money and never asks
          for card details. Questions? Ring {storeConfig.contact.telephonePlaceholder} or email{' '}
          {storeConfig.contact.email}.
        </p>
        <p style={{ margin: '4mm 0 0', fontWeight: 800 }}>{watermark}.</p>
        <p style={{ margin: '8mm 0 0', fontSize: '3mm' }}>
          {storeConfig.store.legalEntityName}, company number {storeConfig.store.companyNumber},{' '}
          {storeConfig.store.registeredOffice}.
        </p>
      </div>
    </div>
  );
}
