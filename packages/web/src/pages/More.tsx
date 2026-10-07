import { Link } from 'react-router-dom';

import { storeConfig } from '../config';

/** Everything beyond the shopping itself, in one place, so the menu stays short. */
export function More(): JSX.Element {
  const assistant = storeConfig.assistantName;
  const links: Array<{ to: string; name: string; about: string }> = [
    { to: '/recipes', name: `${assistant} Recipes`, about: 'Simple, healthy meals, read aloud.' },
    {
      to: '/gifts',
      name: 'Little Gifts',
      about: 'A card, flowers or chocolates, brought with your shopping.',
    },
    {
      to: '/find-it',
      name: `${assistant} Finds It`,
      about: 'Something hard to find, looked for in up to three shops.',
    },
    {
      to: '/weekly-shop',
      name: 'Your weekly shop',
      about: 'Your usual shopping, on the same day each week.',
    },
    {
      to: '/plus',
      name: `${assistant} Plus`,
      about: 'Recipes and Finds It included, for you or your family.',
    },
    { to: '/gift-cards', name: 'Gift cards', about: 'Give someone their shopping.' },
    {
      to: '/shops',
      name: 'Local shops',
      about: 'Shop Partners, with their own products and prices.',
    },
    { to: '/offers', name: 'Offers', about: 'From local shops we work with.' },
    {
      to: '/shop?q=essentials',
      name: 'Everyday essentials, today',
      about: 'Batteries, a charging cable, light bulbs: brought today, no waiting for a parcel.',
    },
    {
      to: '/organisations',
      name: 'For organisations',
      about: 'Councils, charities, care providers and businesses.',
    },
  ];
  return (
    <div className="space-y-8 max-w-xl">
      <h1 className="text-display font-bold m-0">More from {storeConfig.productName}</h1>
      <ul className="list-none m-0 p-0 space-y-3">
        {links.map((link) => (
          <li key={link.to}>
            <Link
              to={link.to}
              className="block border-2 border-paper rounded-xl p-4 text-paper no-underline"
            >
              <span className="block text-lead font-bold underline">{link.name}</span>
              <span className="block">{link.about}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
