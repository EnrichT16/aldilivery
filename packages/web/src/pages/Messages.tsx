import { Link } from 'react-router-dom';

import { Inbox } from '../components/Inbox';
import { businessToken } from '../lib/api';
import { readRunnerToken } from '../lib/session';
import { useSession } from '../state/session';

/**
 * Each account's Messages page (ruling 77): the company inbox, reached from the account's own
 * main page. A Shopper's from More and the bar at the top, a Runner's from the Runner page, a
 * Shop Partner's and an organisation's from their dashboards.
 */

function SignInFirst({ to, words }: { to: string; words: string }): JSX.Element {
  return (
    <div className="space-y-4 max-w-xl">
      <h1 className="text-display font-bold m-0">Messages</h1>
      <p className="m-0">Please sign in first, to see your messages.</p>
      <Link to={to} className="control bg-highlight text-on-accent">
        {words}
      </Link>
    </div>
  );
}

export function ShopperMessages(): JSX.Element {
  const { shopper, restoring } = useSession();
  if (restoring) {
    return (
      <p role="status" className="m-0">
        One moment.
      </p>
    );
  }
  if (!shopper) return <SignInFirst to="/sign-in" words="Sign in" />;
  return <Inbox as="shopper" />;
}

export function RunnerMessages(): JSX.Element {
  if (!readRunnerToken()) return <SignInFirst to="/runner/sign-in" words="Sign in as a Runner" />;
  return (
    <div className="space-y-4">
      <Link to="/runner/home" className="control px-0 text-paper underline">
        Back to your Runner page
      </Link>
      <Inbox as="runner" />
    </div>
  );
}

export function BusinessMessages({ back }: { back: '/partner' | '/organisation' }): JSX.Element {
  if (!businessToken()) return <SignInFirst to="/business" words="Sign in" />;
  return (
    <div className="space-y-4">
      <Link to={back} className="control px-0 text-paper underline">
        Back to your dashboard
      </Link>
      <Inbox as="business" />
    </div>
  );
}
