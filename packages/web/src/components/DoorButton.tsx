import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * One of the three doors on the landing page.
 *
 * A door is a link, not a button, because it goes somewhere. The heading inside it is the
 * accessible name; the sentence underneath is read out after it, so someone using a screen
 * reader hears "Shopper, link. I want my shopping brought to me."
 */
export function DoorButton({
  to,
  title,
  description,
}: {
  to: string;
  title: string;
  description: ReactNode;
}): JSX.Element {
  return (
    <Link
      to={to}
      className="control w-full flex-col items-center justify-center text-center bg-paper text-ink border-2 border-paper min-h-[4.5rem] px-3"
    >
      <span className="font-bold leading-tight">{title}</span>
      <span className="font-normal extra">{description}</span>
    </Link>
  );
}
