import rawAdverts from '@adverts';
import { Link, useLocation } from 'react-router-dom';

import { storeConfig } from '../config';
import { useSession } from '../state/session';

interface Advert {
  id: string;
  title: string;
  words: string;
  link: string;
  from: string;
}

const config = rawAdverts as { enabled?: boolean; adverts?: Advert[] };

/** Never on the screens where money is paid, cards are entered, or staff work. */
const NEVER_ON = /^\/(card|confirm|basket|staff|business|sign-in|sign-up|runner\/sign-up|call)/;

/**
 * The advert square (ruling 43): a small square, in the corner, clearly called an advert, one
 * at a time, still, never flashing, never read aloud by Ozi, never where money is paid. Off until
 * the owner switches it on in config/adverts.json. Never shown on Ozi Plus or Family and Carer
 * (ruling 58: no adverts, ever).
 */
export function AdSquare(): JSX.Element | null {
  const { pathname } = useLocation();
  const { shopper } = useSession();
  const adverts = config.adverts ?? [];
  // Ozi Plus and Family and Carer: no adverts, ever (ruling 58).
  const plus = Boolean(shopper?.plusExtras);
  if (!config.enabled || adverts.length === 0 || NEVER_ON.test(pathname) || plus) {
    return null;
  }
  // A different one each day, the same all day.
  const advert = adverts[new Date().getDate() % adverts.length] as Advert;
  const inside = advert.link.startsWith('/');
  return (
    <aside
      aria-label="Advert"
      className="float-right ml-4 mb-4 w-48 border-2 border-paper/60 rounded-xl p-3 space-y-1 text-sm"
    >
      <p className="m-0 font-bold uppercase tracking-wide">Advert</p>
      {inside ? (
        <Link to={advert.link} className="block text-paper underline font-bold">
          {advert.title}
        </Link>
      ) : (
        <a
          href={advert.link}
          rel="sponsored noopener"
          className="block text-paper underline font-bold"
        >
          {advert.title}
        </a>
      )}
      <p className="m-0">{advert.words}</p>
      <p className="m-0 text-paper/80">
        From {advert.from === 'house' ? storeConfig.productName : advert.from}
      </p>
    </aside>
  );
}
