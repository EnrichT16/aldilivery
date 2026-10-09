import { storeConfig } from '../config';

/**
 * Who runs the service, as the law asks it to be shown (Companies Act 2006 and the trading
 * disclosure regulations of 2015, the E-Commerce Regulations 2002, the Consumer Contracts
 * Regulations 2013 and UK GDPR Article 13): the company's registered name, where it is
 * registered, its number, its registered office, an email address and a telephone number.
 *
 * Every detail comes from config/store.json (Rule Nine). A detail still marked as a placeholder
 * there is shown as "to follow", never as the made-up value, so nobody writes to an address or
 * quotes a number that does not exist. docs/LEGAL_REVIEW.md lists what Anthony fills in.
 */

const TO_FOLLOW = 'to follow';

export interface CompanyFacts {
  name: string;
  registeredIn: string;
  number: string;
  office: string;
  email: string | null;
  telephone: string;
  telephoneIsPlaceholder: boolean;
  ico: string;
}

export function companyFacts(): CompanyFacts {
  const { store, contact } = storeConfig;
  return {
    name: store.legalEntityIsPlaceholder ? 'the company that runs it' : store.legalEntityName,
    registeredIn: store.registeredIn,
    number: store.companyNumberIsPlaceholder ? TO_FOLLOW : store.companyNumber,
    office: store.registeredOfficeIsPlaceholder ? TO_FOLLOW : store.registeredOffice,
    email: contact.emailIsPlaceholder ? null : contact.email,
    telephone: contact.telephonePlaceholder,
    telephoneIsPlaceholder: contact.telephoneIsPlaceholder,
    ico: store.icoRegistrationIsPlaceholder ? TO_FOLLOW : store.icoRegistrationNumber,
  };
}

/** The details still waiting to be filled in, in plain words, or an empty list. */
export function detailsToFollow(): string[] {
  const { store, contact } = storeConfig;
  const missing: string[] = [];
  if (store.legalEntityIsPlaceholder) missing.push('our company name');
  if (store.companyNumberIsPlaceholder) missing.push('our company number');
  if (store.registeredOfficeIsPlaceholder) missing.push('our registered office address');
  if (store.icoRegistrationIsPlaceholder) missing.push('our registration number with the ICO');
  if (contact.emailIsPlaceholder) missing.push('our email address');
  if (contact.telephoneIsPlaceholder) missing.push('our telephone number');
  return missing;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * A plain notice, shown only while some detail is still a placeholder. It replaced the old
 * "this is a draft" box on the privacy page and the terms (ruling 54).
 */
export function DetailsToFollowNotice(): JSX.Element | null {
  const missing = detailsToFollow();
  if (missing.length === 0) return null;
  return (
    <p className="m-0 border-2 border-paper rounded-xl p-4">
      We are still adding {list(missing)}. Until then, where this page says &ldquo;to follow&rdquo;,
      ring us and a person will give you the details.
    </p>
  );
}

/** The company's details as a short list, for the legal pages. */
export function CompanyDetails(): JSX.Element {
  const facts = companyFacts();
  return (
    <ul className="m-0 ps-6 space-y-2">
      <li>
        Company: {facts.name}, registered in {facts.registeredIn}.
      </li>
      <li>Company number: {facts.number}.</li>
      <li>Registered office: {facts.office}.</li>
      <li>
        Telephone: {facts.telephone}
        {facts.telephoneIsPlaceholder ? ' (a placeholder while we get the line set up)' : ''}.
      </li>
      <li>Email: {facts.email ?? TO_FOLLOW}.</li>
      <li>Registration number with the Information Commissioner&rsquo;s Office: {facts.ico}.</li>
    </ul>
  );
}
