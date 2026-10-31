/**
 * The four A5 flyers (Anthony, 30 October 2026), made in the app for each approved Ambassador:
 * Shoppers, Carers and families, Restaurants and shops, and Runners (drivers). The same designs
 * as the printed ones, with the Ambassador's own QR code (their business link on the business
 * flyer, their referral link on the others) and a small "Your Ambassador: <first name>" line.
 * Printed, or saved as a PDF, from the browser's print window at A5.
 *
 * Since 31 October 2026 every QR code goes through the public check page first, and every flyer
 * carries the payment warning, word for word ("Joining … is always free").
 *
 * Every name, number and price comes from config/store.json. No supermarket is named, nothing is
 * said about insurance, and nothing promises anybody an income.
 */

import { rewardWords } from '@aldilivery/core';

import { storeConfig } from '../../config';
import type { AmbassadorToolkit } from '../../lib/api';
import { money } from '../../lib/money';
import { FREE_JOINING_WORDS } from '../FreeJoiningNotice';
import { QrCode } from '../QrCode';

const NAVY = storeConfig.brand.colours.navy;

/** The code in a link (its via, ambassador or ref), for anyone who would rather type it. */
export function codeOf(link: string): string {
  const found = /[?&](?:via|ambassador|ref)=([^&#]+)/.exec(link);
  return found ? decodeURIComponent(found[1] ?? '') : '';
}

function site(): string {
  return storeConfig.contact.website.replace(/^www\./, '');
}

function legalLine(): string {
  const { store, contact } = storeConfig;
  return [
    store.legalEntityName,
    `Company no. ${store.companyNumber}`,
    store.registeredOffice,
    contact.email,
  ].join(' · ');
}

/** The styles all four share: an A5 page, the QR panel, the legal line. */
export const FLYER_BASE_CSS = `
  .fl-page { width: 148mm; height: 210mm; position: relative; overflow: hidden; box-sizing: border-box; font-family: 'Inter', 'Noto Color Emoji', sans-serif; color: ${NAVY}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .fl-page * { box-sizing: border-box; }
  .fl-page .e { font-family: 'Noto Color Emoji', sans-serif; line-height: 1; }
  .fl-page .disp { font-family: 'Inter Display', 'Inter', sans-serif; font-weight: 900; letter-spacing: -0.025em; line-height: .98; }
  .fl-page .qr { background: #fff; border-radius: 3mm; padding: 1.6mm; }
  .fl-page .qr svg { display: block; width: 100%; height: 100%; }
  .fl-page .legal { position: absolute; left: 0; right: 0; bottom: 0; font-size: 2.3mm; text-align: center; padding: 1.8mm 6mm; color: #fff; }
  .fl-page .amb { font-size: 3mm; font-weight: 800; margin-top: 1mm; }
  .fl-page .fl-warn { position: absolute; left: 0; right: 0; bottom: 5.5mm; background: #fff; color: ${NAVY}; font-size: 2.2mm; font-weight: 700; line-height: 1.3; text-align: center; padding: 1mm 5mm; }
`;

/**
 * Where each printed QR code goes (31 October 2026): the public check page first, then on to the
 * link, so a suspension takes effect at once on paper already printed. An older server without
 * print links gives the link itself.
 */
export function printLinkFor(toolkit: AmbassadorToolkit, which: 'business' | 'shopper' | 'runner'): string {
  const own =
    which === 'business'
      ? toolkit.businessLink
      : which === 'shopper'
        ? toolkit.shopperLink
        : toolkit.runnerLink;
  return toolkit.printLinks?.[which] ?? own;
}

/** The payment warning, word for word, on every flyer. */
function Warning(): JSX.Element {
  return <p className="fl-warn" style={{ margin: 0 }}>{FREE_JOINING_WORDS}</p>;
}

function Qr({ link, label }: { link: string; label: string }): JSX.Element {
  return (
    <div className="qr">
      <QrCode value={link} label={label} dark={NAVY} />
    </div>
  );
}

function Ambassador({ toolkit, link }: { toolkit: AmbassadorToolkit; link: string }): JSX.Element {
  const code = toolkit.checkCode ?? codeOf(link);
  return (
    <div className="amb">
      Your Ambassador: {toolkit.firstName}
      {toolkit.checkCode
        ? ` · Check code ${code} at ${site()}/ambassador/check`
        : code
          ? ` · Code ${code}`
          : ''}
    </div>
  );
}

/* ---------------- Shoppers: sunburst ---------------- */

function ShoppersFlyer({ toolkit }: { toolkit: AmbassadorToolkit }): JSX.Element {
  const link = toolkit.shopperLink;
  const qr = printLinkFor(toolkit, 'shopper');
  const extras = storeConfig.extras;
  return (
    <div
      className="fl-page"
      style={{
        background:
          'radial-gradient(circle at 80% 12%, #FFE27A 0, #FFB547 28%, #FF7A59 58%, #E8467C 100%)',
      }}
    >
      <style>{`
        .sa-ring { position:absolute; right:-18mm; top:-18mm; width:92mm; height:92mm; border-radius:50%; border: 6mm solid rgba(255,255,255,.28); }
        .sa-ring2 { position:absolute; left:-25mm; bottom:40mm; width:70mm; height:70mm; border-radius:50%; background: rgba(255,255,255,.14); }
        .sa-logo { position:absolute; left:10mm; top:10mm; font-size:7.5mm; color:#fff; }
        .sa-motto { position:absolute; left:10mm; top:19mm; font-size:3.4mm; color:#fff; font-weight:700; opacity:.95; }
        .sa-h { position:absolute; left:10mm; top:31mm; font-size:15mm; color:${NAVY}; margin:0; }
        .sa-h span { color:#fff; text-shadow: 0 .6mm 0 rgba(11,31,58,.25); }
        .sa-bubble { position:absolute; left:10mm; top:74mm; background:#fff; border-radius:6mm; padding:3.5mm 5mm; font-size:4.6mm; font-weight:800; box-shadow: 0 1.5mm 0 rgba(11,31,58,.18); }
        .sa-food { position:absolute; right:8mm; top:63mm; display:grid; grid-template-columns: repeat(3, 13mm); gap:1.5mm; }
        .sa-food span { background:rgba(255,255,255,.55); border-radius:50%; width:13mm; height:13mm; display:flex; align-items:center; justify-content:center; font-size:7.5mm; }
        .sa-steps { position:absolute; left:8mm; right:8mm; top:100mm; display:grid; grid-template-columns: repeat(3,1fr); gap:3mm; }
        .sa-step { background:#fff; border-radius:5mm; padding:3.5mm 2.5mm; text-align:center; box-shadow:0 1.2mm 0 rgba(11,31,58,.15); }
        .sa-step .e { font-size:9mm; display:block; margin-bottom:1.5mm; }
        .sa-step b { display:block; font-size:4.2mm; }
        .sa-step small { display:block; font-size:2.9mm; line-height:1.3; margin-top:1mm; }
        .sa-burst { position:absolute; right:8mm; top:127mm; width:33mm; height:33mm; border-radius:50%; background:${NAVY}; color:#FFE27A; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; transform: rotate(-10deg); }
        .sa-burst b { font-size:9mm; line-height:1; }
        .sa-burst small { font-size:3mm; font-weight:800; color:#fff; line-height:1.15; margin-top:1mm; }
        .sa-call { position:absolute; left:10mm; top:132mm; width:84mm; }
        .sa-call .row { font-size:4.1mm; font-weight:800; color:#fff; margin-bottom:1.6mm; }
        .sa-call .tel { font-size:7.4mm; font-weight:900; color:${NAVY}; }
        .sa-bottom { position:absolute; left:8mm; right:8mm; bottom:15mm; background:#fff; border-radius:6mm; padding:3.5mm; display:flex; gap:4mm; align-items:center; }
        .sa-bottom .qr { width:24mm; height:24mm; padding:0; flex:none; }
        .sa-bottom b { font-size:5.4mm; display:block; }
        .sa-bottom .url { font-size:4.6mm; font-weight:900; color:#C2185B; }
        .sa-bottom small { font-size:3mm; display:block; margin-top:.8mm; }
      `}</style>
      <div className="sa-ring" aria-hidden="true" />
      <div className="sa-ring2" aria-hidden="true" />
      <div className="disp sa-logo">{storeConfig.productName}</div>
      <div className="sa-motto">{storeConfig.motto}</div>
      <p className="disp sa-h">
        Just say it.
        <br />
        <span>We shop it.</span>
      </p>
      <div className="sa-bubble">
        &ldquo;{storeConfig.assistantName}, get me milk, bread and eggs.&rdquo;
      </div>
      <div className="sa-food" aria-hidden="true">
        {['🥛', '🍞', '🥚', '🍌', '🥕', '🧀'].map((food) => (
          <span key={food} className="e">
            {food}
          </span>
        ))}
      </div>
      <div className="sa-steps">
        <div className="sa-step">
          <span className="e" aria-hidden="true">
            🗣️
          </span>
          <b>Say it</b>
          <small>Talk, type or ring. No typing needed.</small>
        </div>
        <div className="sa-step">
          <span className="e" aria-hidden="true">
            🛒
          </span>
          <b>We shop it</b>
          <small>A checked local Runner (driver) buys it.</small>
        </div>
        <div className="sa-step">
          <span className="e" aria-hidden="true">
            🏠
          </span>
          <b>At your door</b>
          <small>Clear prices, shown before you pay.</small>
        </div>
      </div>
      <div className="sa-call">
        <div className="row">No smartphone? Just ring us:</div>
        <div className="tel">{storeConfig.contact.telephonePlaceholder}</div>
        <div className="row" style={{ marginTop: '3mm' }}>
          Local shops, restaurants
          <br />
          and takeaways near you
        </div>
      </div>
      {extras.freeFirstMonth && (
        <div className="sa-burst">
          <b>FREE</b>
          <small>
            first month of
            <br />
            membership
          </small>
        </div>
      )}
      <div className="sa-bottom">
        <Qr link={qr} label={`QR code: ${toolkit.firstName}'s link to start shopping`} />
        <div>
          <b>Scan to start</b>
          <div className="url">{site()}</div>
          <small>
            Made for everyone, including people who are blind, elderly or housebound. Not in the app
            stores yet: use our website.
          </small>
          <Ambassador toolkit={toolkit} link={link} />
        </div>
      </div>
      <Warning />
      <div className="legal">{legalLine()}</div>
    </div>
  );
}

/* ---------------- Carers and families: fresh tiles ---------------- */

function CarersFlyer({ toolkit }: { toolkit: AmbassadorToolkit }): JSX.Element {
  const link = toolkit.shopperLink;
  const qr = printLinkFor(toolkit, 'shopper');
  const extras = storeConfig.extras;
  return (
    <div
      className="fl-page"
      style={{ background: 'linear-gradient(160deg, #0E8F79 0%, #1673B0 48%, #5236B8 100%)' }}
    >
      <style>{`
        .sb-blob { position:absolute; border-radius:50%; }
        .sb-logo { position:absolute; left:10mm; top:10mm; font-size:7.5mm; color:#FFE27A; }
        .sb-h { position:absolute; left:10mm; top:22mm; font-size:13.5mm; color:#fff; margin:0; }
        .sb-sub { position:absolute; left:10mm; top:52mm; right:10mm; font-size:4.3mm; color:#fff; font-weight:600; line-height:1.35; margin:0; }
        .sb-grid { position:absolute; left:8mm; right:8mm; top:68mm; display:grid; grid-template-columns:1fr 1fr; gap:3mm; }
        .sb-tile { border-radius:5mm; padding:3.6mm; color:${NAVY}; min-height:30mm; }
        .sb-tile .e { font-size:8mm; }
        .sb-tile b { display:block; font-size:4.4mm; margin-top:1.4mm; }
        .sb-tile small { display:block; font-size:3mm; line-height:1.3; margin-top:.8mm; }
        .sb-carer { position:absolute; left:8mm; right:8mm; top:139mm; background:${NAVY}; color:#fff; border-radius:5mm; padding:3.6mm 4mm; display:flex; gap:3.5mm; align-items:center; }
        .sb-carer .e { font-size:10mm; }
        .sb-carer b { font-size:4.4mm; color:#FFE27A; display:block; }
        .sb-carer small { font-size:3.1mm; line-height:1.3; display:block; }
        .sb-bottom { position:absolute; left:8mm; right:8mm; bottom:15mm; display:flex; gap:4mm; align-items:center; color:#fff; }
        .sb-bottom .qr { width:30mm; height:30mm; flex:none; }
        .sb-bottom .big { font-size:6mm; font-weight:900; line-height:1.1; }
        .sb-bottom .free { display:inline-block; background:#FFE27A; color:${NAVY}; font-weight:900; font-size:3.6mm; padding:1.2mm 3mm; border-radius:10mm; margin-top:2mm; }
        .sb-bottom .tel { font-size:4.4mm; font-weight:800; margin-top:2mm; }
      `}</style>
      <div
        className="sb-blob"
        aria-hidden="true"
        style={{
          right: '-20mm',
          top: '-16mm',
          width: '70mm',
          height: '70mm',
          background: 'rgba(255,226,122,.35)',
        }}
      />
      <div className="disp sb-logo">{storeConfig.productName}</div>
      <p className="disp sb-h">
        Looking after
        <br />
        Mum or Dad?
      </p>
      <p className="sb-sub">
        {storeConfig.productName} does their shopping, and you stay in control from wherever you
        are.
      </p>
      <div className="sb-grid">
        <div className="sb-tile" style={{ background: '#FFE27A' }}>
          <span className="e" aria-hidden="true">
            👨‍👩‍👧
          </span>
          <b>Up to {extras.familyMaximum} homes</b>
          <small>
            One Family and Carer plan,{' '}
            {rewardWords(extras.familyPence, storeConfig.store.currencySymbol)} a month, for up to{' '}
            {extras.familyMaximum} people in different homes.
          </small>
        </div>
        <div className="sb-tile" style={{ background: '#FFB3C7' }}>
          <span className="e" aria-hidden="true">
            🔔
          </span>
          <b>See every order</b>
          <small>You&rsquo;re told when it&rsquo;s placed, on its way and delivered.</small>
        </div>
        <div className="sb-tile" style={{ background: '#B8F2D6' }}>
          <span className="e" aria-hidden="true">
            💷
          </span>
          <b>Set a limit</b>
          <small>Orders above your spending limit wait for your yes.</small>
        </div>
        <div className="sb-tile" style={{ background: '#CFE3FF' }}>
          <span className="e" aria-hidden="true">
            ✅
          </span>
          <b>Checked Runners</b>
          <small>DBS-checked Runners. Your number is never shared.</small>
        </div>
      </div>
      <div className="sb-carer">
        <span className="e" aria-hidden="true">
          🎙️
        </span>
        <div>
          <b>They can order too</b>
          <small>
            By speaking to {storeConfig.assistantName}, or by ringing{' '}
            {storeConfig.contact.telephonePlaceholder} from any phone, even a landline. No typing
            needed.
          </small>
        </div>
      </div>
      <div className="sb-bottom">
        <Qr link={qr} label={`QR code: ${toolkit.firstName}'s link to join`} />
        <div>
          <div className="big">
            Scan or visit
            <br />
            {site()}
          </div>
          {extras.freeFirstMonth && <div className="free">First month of membership free</div>}
          <div className="tel">Ring {storeConfig.contact.telephonePlaceholder}</div>
          <Ambassador toolkit={toolkit} link={link} />
        </div>
      </div>
      <Warning />
      <div className="legal">{legalLine()}</div>
    </div>
  );
}

/* ---------------- Restaurants and shops: bold magenta ---------------- */

function BusinessFlyer({ toolkit }: { toolkit: AmbassadorToolkit }): JSX.Element {
  const link = toolkit.businessLink;
  const qr = printLinkFor(toolkit, 'business');
  const partners = storeConfig.extras.partners;
  return (
    <div
      className="fl-page"
      style={{ background: 'linear-gradient(150deg, #D81B60 0%, #E65100 55%, #F9A825 100%)' }}
    >
      <style>{`
        .pa-stripe { position:absolute; left:-20mm; top:96mm; width:200mm; height:24mm; background:rgba(255,255,255,.14); transform:rotate(-8deg); }
        .pa-logo { position:absolute; left:10mm; top:10mm; font-size:7.5mm; color:#fff; }
        .pa-tag { position:absolute; right:10mm; top:11mm; background:${NAVY}; color:#FFE27A; font-weight:900; font-size:3.4mm; padding:1.6mm 3.4mm; border-radius:10mm; }
        .pa-h { position:absolute; left:10mm; top:24mm; font-size:15mm; color:#fff; margin:0; }
        .pa-h span { color:${NAVY}; }
        .pa-sub { position:absolute; left:10mm; right:10mm; top:59mm; font-size:4.3mm; font-weight:700; color:#fff; line-height:1.35; margin:0; }
        .pa-plans { position:absolute; left:8mm; right:8mm; top:78mm; display:grid; grid-template-columns:1fr 1fr; gap:3mm; }
        .pa-plan { background:#fff; border-radius:5mm; padding:3.6mm; }
        .pa-plan .name { font-size:3.4mm; font-weight:900; text-transform:uppercase; letter-spacing:.06em; color:#C2185B; }
        .pa-plan .price { font-size:8mm; font-weight:900; line-height:1.05; margin:1mm 0; }
        .pa-plan .price small { font-size:3mm; font-weight:700; }
        .pa-plan ul { margin:0; padding:0; list-style:none; font-size:3.05mm; line-height:1.35; }
        .pa-scan { position:absolute; left:8mm; right:8mm; top:129mm; background:${NAVY}; color:#fff; border-radius:5mm; padding:3.6mm 4mm; display:flex; gap:3.6mm; align-items:center; }
        .pa-scan .e { font-size:11mm; }
        .pa-scan b { color:#FFE27A; font-size:4.5mm; display:block; }
        .pa-scan small { font-size:3.1mm; line-height:1.3; display:block; }
        .pa-food { position:absolute; left:10mm; top:157mm; font-size:3.6mm; font-weight:800; color:${NAVY}; }
        .pa-bottom { position:absolute; left:8mm; right:8mm; bottom:15mm; background:#fff; border-radius:6mm; padding:3.5mm; display:flex; gap:4mm; align-items:center; }
        .pa-bottom .qr { width:26mm; height:26mm; padding:0; flex:none; }
        .pa-bottom b { font-size:5.6mm; display:block; }
        .pa-bottom .url { font-size:4.4mm; font-weight:900; color:#C2185B; }
        .pa-bottom small { font-size:3mm; display:block; margin-top:.8mm; }
      `}</style>
      <div className="pa-stripe" aria-hidden="true" />
      <div className="disp pa-logo">{storeConfig.productName}</div>
      <div className="pa-tag">FOR RESTAURANTS &amp; SHOPS</div>
      <p className="disp pa-h">
        Put your business
        <br />
        <span>on {storeConfig.assistantName}.</span>
      </p>
      <p className="pa-sub">
        New customers order by voice, app or phone. Our Runners come to you and pay in full at the
        counter.
      </p>
      <div className="pa-plans">
        <div className="pa-plan">
          <div className="name">Basic</div>
          <div className="price">FREE</div>
          <ul>
            <li>Your shop and hours</li>
            <li>Up to {partners.freeProductLimit} products</li>
            <li>Listed on {storeConfig.assistantName}</li>
          </ul>
        </div>
        <div className="pa-plan">
          <div className="name">Partner Plus</div>
          <div className="price">
            {money(partners.plusMonthlyPence)}
            <small> a month</small>
          </div>
          <ul>
            {partners.plusFirstMonthFree && <li>First month free</li>}
            <li>Full catalogue and photos</li>
            <li>Higher in the listings</li>
            <li>Shop of the Month</li>
          </ul>
        </div>
      </div>
      <div className="pa-scan">
        <span className="e" aria-hidden="true">
          📱
        </span>
        <div>
          <b>Add products in seconds</b>
          <small>
            Point your phone at a barcode or shelf label. It captures the name and price for you.
          </small>
        </div>
      </div>
      <div className="pa-food">Restaurants: no commission. Paid instantly, in full.</div>
      <div className="pa-bottom">
        <Qr link={qr} label={`QR code: ${toolkit.firstName}'s link for a business to join`} />
        <div>
          <b>Join free today</b>
          <div className="url">{site()}/business</div>
          <small>Questions? Ring {storeConfig.contact.telephonePlaceholder}</small>
          <Ambassador toolkit={toolkit} link={link} />
        </div>
      </div>
      <Warning />
      <div className="legal">{legalLine()}</div>
    </div>
  );
}

/* ---------------- Runners: green go ---------------- */

function RunnersFlyer({ toolkit }: { toolkit: AmbassadorToolkit }): JSX.Element {
  const link = toolkit.runnerLink;
  const qr = printLinkFor(toolkit, 'runner');
  const fees = storeConfig.fees;
  const symbol = storeConfig.store.currencySymbol;
  return (
    <div
      className="fl-page"
      style={{ background: 'linear-gradient(155deg, #0B7A57 0%, #0E7C93 55%, #1B4FB0 100%)' }}
    >
      <style>{`
        .ra-ring { position:absolute; right:-22mm; top:-22mm; width:90mm; height:90mm; border-radius:50%; border:6mm solid rgba(255,226,122,.45); }
        .ra-logo { position:absolute; left:10mm; top:10mm; font-size:7.5mm; color:#fff; }
        .ra-tag { position:absolute; left:10mm; top:20mm; background:${NAVY}; color:#FFE27A; font-weight:900; font-size:3.4mm; padding:1.4mm 3.2mm; border-radius:10mm; }
        .ra-h { position:absolute; left:10mm; top:30mm; font-size:17mm; color:#fff; margin:0; }
        .ra-h span { color:#FFE27A; }
        .ra-sub { position:absolute; left:10mm; right:10mm; top:68mm; font-size:4.3mm; font-weight:700; color:#fff; line-height:1.35; margin:0; }
        .ra-grid { position:absolute; left:8mm; right:8mm; top:84mm; display:grid; grid-template-columns:1fr 1fr; gap:3mm; }
        .ra-tile { background:#fff; border-radius:5mm; padding:3.2mm; }
        .ra-tile .e { font-size:7.5mm; }
        .ra-tile b { display:block; font-size:4.1mm; margin-top:1mm; }
        .ra-tile small { display:block; font-size:2.95mm; line-height:1.3; margin-top:.6mm; }
        .ra-need { position:absolute; left:8mm; right:8mm; top:142mm; background:${NAVY}; color:#fff; border-radius:5mm; padding:3.2mm 4mm; }
        .ra-need b { color:#FFE27A; font-size:4.2mm; display:block; margin-bottom:1mm; }
        .ra-need small { font-size:3.05mm; line-height:1.35; display:block; }
        .ra-bottom { position:absolute; left:8mm; right:8mm; bottom:15mm; background:#fff; border-radius:6mm; padding:3.5mm; display:flex; gap:4mm; align-items:center; }
        .ra-bottom .qr { width:22mm; height:22mm; padding:0; flex:none; }
        .ra-bottom b { font-size:5.4mm; display:block; }
        .ra-bottom .url { font-size:4.2mm; font-weight:900; color:#0B6B4D; }
        .ra-bottom small { font-size:2.9mm; display:block; margin-top:.8mm; }
      `}</style>
      <div className="ra-ring" aria-hidden="true" />
      <div className="disp ra-logo">{storeConfig.productName}</div>
      <div className="ra-tag">BECOME A RUNNER (DRIVER)</div>
      <p className="disp ra-h">
        Earn {rewardWords(fees.runnerPaymentPence, symbol)}
        <br />
        <span>a delivery.</span>
      </p>
      <p className="ra-sub">
        Shop for people near you and bring it to their door, on your own hours.{' '}
        {rewardWords(fees.largeOrderRunnerPaymentPence, symbol)} for big orders of{' '}
        {rewardWords(fees.largeOrderFromPence, symbol)} or more.
      </p>
      <div className="ra-grid">
        <div className="ra-tile">
          <span className="e" aria-hidden="true">
            🕒
          </span>
          <b>Your own hours</b>
          <small>Go on shift when you&rsquo;re free. Off shift whenever you like.</small>
        </div>
        <div className="ra-tile">
          <span className="e" aria-hidden="true">
            🚗
          </span>
          <b>Any way you travel</b>
          <small>On foot, bicycle, motorbike, car or van.</small>
        </div>
        <div className="ra-tile">
          <span className="e" aria-hidden="true">
            📍
          </span>
          <b>Jobs near you</b>
          <small>Jobs go to Runners in your area, nearest first.</small>
        </div>
        <div className="ra-tile">
          <span className="e" aria-hidden="true">
            💷
          </span>
          <b>Paid to your bank</b>
          <small>Your pay goes to your bank through Stripe.</small>
        </div>
      </div>
      <div className="ra-need">
        <b>What you need</b>
        <small>
          18 or over, the right to work in the UK, a basic DBS check and a smartphone. Drivers also
          need a driving licence. Runners are self-employed.
        </small>
      </div>
      <div className="ra-bottom">
        <Qr link={qr} label={`QR code: ${toolkit.firstName}'s link to sign up as a Runner`} />
        <div>
          <b>Sign up on the app</b>
          <div className="url">{site()}/runner</div>
          <small>Not in the app stores yet: scan the code or use our website.</small>
          <Ambassador toolkit={toolkit} link={link} />
        </div>
      </div>
      <Warning />
      <div className="legal">{legalLine()}</div>
    </div>
  );
}

export type FlyerKey = 'shoppers' | 'carers' | 'business' | 'runners';

export const FLYERS: ReadonlyArray<{
  key: FlyerKey;
  title: string;
  /** Which of their links the flyer is shared with. */
  link: (toolkit: AmbassadorToolkit) => string;
  /** What its printed QR code carries: the check page first, then that link. */
  printLink: (toolkit: AmbassadorToolkit) => string;
  shareText: string;
  Flyer: (props: { toolkit: AmbassadorToolkit }) => JSX.Element;
}> = [
  {
    key: 'shoppers',
    title: 'Shoppers',
    link: (toolkit) => toolkit.shopperLink,
    printLink: (toolkit) => printLinkFor(toolkit, 'shopper'),
    shareText: `Shopping brought to your door by ${storeConfig.productName}:`,
    Flyer: ShoppersFlyer,
  },
  {
    key: 'carers',
    title: 'Carers and families',
    link: (toolkit) => toolkit.shopperLink,
    printLink: (toolkit) => printLinkFor(toolkit, 'shopper'),
    shareText: `${storeConfig.productName} does the shopping for the people you look after:`,
    Flyer: CarersFlyer,
  },
  {
    key: 'business',
    title: 'Restaurants and shops',
    link: (toolkit) => toolkit.businessLink,
    printLink: (toolkit) => printLinkFor(toolkit, 'business'),
    shareText: `Put your business on ${storeConfig.productName}, free:`,
    Flyer: BusinessFlyer,
  },
  {
    key: 'runners',
    title: 'Runners (drivers)',
    link: (toolkit) => toolkit.runnerLink,
    printLink: (toolkit) => printLinkFor(toolkit, 'runner'),
    shareText: `Deliver for ${storeConfig.productName}, on your own hours:`,
    Flyer: RunnersFlyer,
  },
];
