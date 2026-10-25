import { Link, NavLink } from 'react-router-dom';

import { BROWSE, BROWSE_ORDER } from '../lib/browse';

/**
 * The four ways to browse places (ruling 82): Restaurants, Shops, Convenience stores and
 * Services. On the Shopper's home page they are four large tiles near the top; on each browse
 * page, a row of tabs, the one showing marked as the current page. Every tile and tab has its
 * words on it; the emoji is decoration only.
 */
export function BrowseNav({ variant }: { variant: 'tiles' | 'tabs' }): JSX.Element {
  if (variant === 'tiles') {
    return (
      <nav aria-labelledby="browse-places-heading" className="space-y-3">
        <h2 id="browse-places-heading" className="text-lead font-bold m-0">
          Browse places
        </h2>
        <ul className="list-none m-0 p-0 grid grid-cols-2 gap-3">
          {BROWSE_ORDER.map((section) => {
            const info = BROWSE[section];
            return (
              <li key={section}>
                <Link
                  to={info.path}
                  className="card-surface control flex flex-col items-center justify-center gap-1 h-full min-h-[6.5rem] rounded-3xl p-3 no-underline text-center font-bold text-lead"
                >
                  <span aria-hidden="true" className="text-[2.2rem] leading-none">
                    {info.emoji}
                  </span>
                  <span className="leading-tight">{info.tab}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }
  return (
    <nav aria-label="Places to browse">
      <ul className="list-none m-0 p-0 flex flex-wrap gap-2">
        {BROWSE_ORDER.map((section) => {
          const info = BROWSE[section];
          return (
            <li key={section}>
              <NavLink
                to={info.path}
                end
                className={({ isActive }) =>
                  `control !rounded-full border-2 font-bold no-underline ${
                    isActive
                      ? 'bg-highlight text-on-accent border-highlight'
                      : 'border-paper bg-paper/10 text-paper'
                  }`
                }
              >
                <span aria-hidden="true">{info.emoji}</span> {info.tab}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
