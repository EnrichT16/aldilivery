import { Component, type ErrorInfo, type ReactNode } from 'react';

import { storeConfig } from '../config';
import { healOnce } from '../lib/updates';
import { AppVersion } from './AppVersion';
import { ResetAppButton } from './ResetApp';

interface Props {
  children: ReactNode;
  /** For tests; `healOnce` from lib/updates otherwise. */
  heal?: () => Promise<boolean>;
}

interface State {
  failed: boolean;
  /** What the heal came to: still going, done (the page is reloading), or not getting better. */
  outcome: 'healing' | 'stuck';
}

/**
 * The last line of defence at the root of the app (ruling 95). When anything below it throws
 * while drawing, which is what a half-loaded copy of the app does, the saved copy is thrown
 * away once and the page reloads (`healOnce`). Plain words meanwhile, in an alert a screen
 * reader hears. When that has already been tried for this build, no more reloading: the person
 * is told to close the app and open it again, with "Reset the app" to hand.
 *
 * A class, because React only gives error boundaries to classes. Nothing from the providers is
 * used here: they may be the very thing that failed.
 */
export class LoadGuard extends Component<Props, State> {
  override state: State = { failed: false, outcome: 'healing' };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The app could not draw its screen.', error, info.componentStack);
    const heal = this.props.heal ?? (() => healOnce());
    void heal().then(
      (did) => {
        if (!did) this.setState({ outcome: 'stuck' });
      },
      () => this.setState({ outcome: 'stuck' }),
    );
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const name = storeConfig.productName;
    const stuck = this.state.outcome === 'stuck';
    return (
      <main id="main" className="min-h-screen bg-ink text-paper px-5 py-8">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <h1 className="text-display font-bold m-0">Something went wrong loading {name}.</h1>
          <p role="alert" className="text-lead m-0">
            {stuck ? 'Please close the app and open it again.' : 'Reloading…'}
          </p>
          {stuck && (
            <>
              <p className="m-0 max-w-xl">
                If it still does not load, press Reset the app. You stay signed in.
              </p>
              <ResetAppButton />
            </>
          )}
          <AppVersion />
        </div>
      </main>
    );
  }
}
