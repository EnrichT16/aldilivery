import { Link } from 'react-router-dom';

import { storeConfig } from '../config';

/**
 * For family and carers (docs/BUILD_PROMPT.md, T1): someone who wants to help a Shopper with their
 * shopping. The family and carer plan is £3.99 a month for each Shopper looked after, with up to
 * three family members connected, paid by a family member, the Shopper, or an organisation. The
 * plan itself is still being built, so this page says what it will be, and what can be done now.
 */
export function LookingAfter(): JSX.Element {
  return (
    <div className="space-y-8">
      <h1 className="text-display font-bold m-0">If you look after someone</h1>
      <p className="text-lead m-0 max-w-xl">
        Many people help a parent, a relative or a friend with their shopping.{' '}
        {storeConfig.productName} is built so you can help without doing it all yourself.
      </p>
      <section aria-labelledby="now-heading" className="space-y-3 max-w-xl">
        <h2 id="now-heading" className="text-lead font-bold">
          What you can do now
        </h2>
        <ul className="m-0 ps-6 space-y-2">
          <li>Help them set up their own account, and save an address for them.</li>
          <li>
            Join a call between them and their Runner, when they add you, to speak for them. They
            send you a link; you do not need an account.
          </li>
          <li>Send shopping to them from your own account, to an address you save.</li>
        </ul>
      </section>
      <section aria-labelledby="plan-heading" className="space-y-3 max-w-xl">
        <h2 id="plan-heading" className="text-lead font-bold">
          Coming soon: the family and carer plan
        </h2>
        <p className="m-0">
          £3.99 a month for each person you look after. Up to three family members can be connected,
          to see how their orders are going and help when something is not on the shelf. It can be
          paid by you, by them, or by an organisation. It is not ready yet; we will say here when it
          is.
        </p>
      </section>
      <Link to="/sign-up" className="control bg-highlight text-ink">
        Set up an account
      </Link>
      <Link to="/" className="control bg-paper/10 text-paper underline">
        Back to the start
      </Link>
    </div>
  );
}
