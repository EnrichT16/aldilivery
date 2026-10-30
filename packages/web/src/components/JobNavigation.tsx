import { directionsLink, isApplePhone, type TravelMode } from '../lib/runner-api';

/**
 * Directions to the shop and to the door (docs/BUILD_PROMPT.md, Section M), each one tap that
 * opens the phone's own maps app: Apple Maps on an iPhone, Google Maps on everything else, the
 * way the Runner is travelling today.
 *
 * The shop is the Shop Partner whose things are in the order, by name, when there is one; and
 * otherwise a search for a supermarket near wherever the Runner is. We have no partnership with
 * any supermarket, so none is named (Anthony, 30 October 2026). The door is the Shopper's address, which the server gives only to the Runner who has the
 * job, only while it is in hand (`GET /jobs/current`); old jobs show the area alone. Nothing is
 * kept on the phone, and the address goes only to the maps app the Runner opens.
 */
export function JobNavigation({
  address,
  shopNames = [],
  mode,
  stage,
}: {
  address: string;
  /** The Shop Partners whose things are in the order: the first is the one to go to. */
  shopNames?: readonly string[];
  mode: TravelMode;
  /** Shopping first, then the door: the next one is shown first. */
  stage: 'to-shop' | 'to-door';
}): JSX.Element {
  const apple = isApplePhone();
  const partner = shopNames[0];
  const links = [
    {
      key: 'shop',
      label: `Directions to the shop`,
      hint: partner
        ? `Opens your maps app to the shop, ${partner}.`
        : 'Opens your maps app to the shop, searching for a supermarket near you.',
      href: directionsLink(partner ?? 'supermarket', mode, apple),
    },
    {
      key: 'door',
      label: 'Directions to the door',
      hint: 'Opens your maps app with the delivery address.',
      href: directionsLink(address, mode, apple),
    },
  ];
  if (stage === 'to-door') links.reverse();
  return (
    <div className="space-y-2">
      <h3 className="text-lead font-bold m-0">Getting there</h3>
      <ul className="list-none m-0 p-0 space-y-2">
        {links.map((link, index) => (
          <li key={link.key}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby={`nav-${link.key}-hint`}
              className={`control w-full ${index === 0 ? 'bg-highlight text-on-accent' : 'bg-paper/10 text-paper underline'}`}
            >
              {link.label}
              <span className="visually-hidden"> (opens your maps app)</span>
            </a>
            <p id={`nav-${link.key}-hint`} className="m-0 extra">
              {link.hint}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
