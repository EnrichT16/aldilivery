import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { storeConfig } from '../config';
import {
  businessSignIn,
  changeBusinessPassword,
  rememberBusinessToken,
  type BusinessMe,
} from '../lib/api';
import { useOzi } from '../state/ozi';
import { nameHeardIn } from '../voice/name';

const field = 'w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3';

/** Where each kind of business account lands once signed in. */
export function businessHome(kind: BusinessMe['kind']): string {
  return kind === 'partner' ? '/partner' : '/organisation';
}

/**
 * Signing in for a Shop Partner or an organisation (7 October 2026). Its own sign-in, so it is
 * never mixed up with a Shopper's, a Runner's or the admin panel's. The first time, they choose
 * their own password.
 */
export function BusinessSignIn(): JSX.Element {
  const navigate = useNavigate();
  const ozi = useOzi();
  const voice = useRef(ozi);
  voice.current = ozi;
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [first, setFirst] = useState<(BusinessMe & { token: string }) | null>(null);

  useEffect(() => {
    const words = `Sign in for Shop Partners and organisations. Type your username, then your password. For your privacy, I never ask you to say a password out loud.`;
    voice.current.setPageCommands((text) => {
      if (nameHeardIn(text) || /\b(help|what do i do|how)\b/i.test(text))
        void voice.current.say(words);
      return true;
    });
    void voice.current.say(words);
    return () => voice.current.setPageCommands(null);
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const username = String(data.get('business-username') ?? '').trim();
    const password = String(data.get('business-password') ?? '');
    if (username === '' || password === '') {
      setProblem('Please give your username and password.');
      return;
    }
    setBusy(true);
    setProblem('');
    businessSignIn(username, password)
      .then((result) => {
        rememberBusinessToken(result.token);
        if (result.mustChangePassword) setFirst(result);
        else navigate(businessHome(result.kind));
      })
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      )
      .finally(() => setBusy(false));
  };

  const choose = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const chosen = String(data.get('new-password') ?? '');
    if (chosen !== String(data.get('repeat-password') ?? '')) {
      setProblem('The two new passwords are not the same.');
      return;
    }
    changeBusinessPassword(String(data.get('current-password') ?? ''), chosen)
      .then(() => first && navigate(businessHome(first.kind)))
      .catch((failure: unknown) =>
        setProblem(failure instanceof Error ? failure.message : 'That did not work.'),
      );
  };

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="text-display font-bold m-0">Shop Partners and organisations</h1>
      {problem !== '' && (
        <p role="alert" className="border-2 border-paper bg-paper text-ink p-4 rounded-xl m-0">
          {problem}
        </p>
      )}
      {first ? (
        <form onSubmit={choose} className="space-y-4" aria-labelledby="choose-heading">
          <h2 id="choose-heading" className="text-lead font-bold m-0">
            Welcome, {first.name}. Choose your own password
          </h2>
          <p className="m-0">
            At least 10 characters. Nobody at {storeConfig.productName} will know it.
          </p>
          <label htmlFor="current-password" className="block font-bold">
            The password you were given
          </label>
          <input
            id="current-password"
            name="current-password"
            type="password"
            autoComplete="current-password"
            className={field}
          />
          <label htmlFor="new-password" className="block font-bold">
            Your new password
          </label>
          <input
            id="new-password"
            name="new-password"
            type="password"
            autoComplete="new-password"
            className={field}
          />
          <label htmlFor="repeat-password" className="block font-bold">
            Your new password again
          </label>
          <input
            id="repeat-password"
            name="repeat-password"
            type="password"
            autoComplete="new-password"
            className={field}
          />
          <button type="submit" className="control w-full bg-highlight text-ink">
            Save my password
          </button>
        </form>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label htmlFor="business-username" className="block font-bold">
            Username
          </label>
          <input
            id="business-username"
            name="business-username"
            autoComplete="username"
            className={field}
          />
          <label htmlFor="business-password" className="block font-bold">
            Password
          </label>
          <input
            id="business-password"
            name="business-password"
            type="password"
            autoComplete="current-password"
            className={field}
          />
          <button type="submit" disabled={busy} className="control w-full bg-highlight text-ink">
            Sign in
          </button>
        </form>
      )}
      <section aria-labelledby="not-yet" className="space-y-2">
        <h2 id="not-yet" className="text-lead font-bold m-0">
          Not signed up yet?
        </h2>
        <p className="m-0">
          Every local shop is listed free. Shop Partners pay monthly to show their own products and
          prices, and keep them up to date themselves.
        </p>
        <Link to="/organisations?shop=1#enquiry" className="control bg-paper text-ink">
          Become a Shop Partner
        </Link>{' '}
        <Link to="/organisations#enquiry" className="control bg-paper/10 text-paper underline">
          For organisations
        </Link>
      </section>
    </div>
  );
}
