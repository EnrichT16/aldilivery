import { useEffect, useRef, useState } from 'react';

import { storeConfig } from '../config';
import type { ShareLink } from '../lib/api';

/**
 * Your share link and its meter (ruling 44): everyone signed in has one, the owner, staff,
 * family, investors and Shoppers alike, and sees how many people have joined through it.
 */
export function ShareCard({
  load,
  onNews,
}: {
  load: () => Promise<ShareLink>;
  onNews: (text: string) => void;
}): JSX.Element | null {
  const [share, setShare] = useState<ShareLink | null>(null);
  // Loaded once: `load` is a new function on every render of the page.
  const first = useRef(load);

  useEffect(() => {
    let live = true;
    first
      .current()
      .then((found) => {
        if (live) setShare(found);
      })
      .catch(() => {
        // No link today: the card simply is not shown.
      });
    return () => {
      live = false;
    };
  }, []);

  if (!share) return null;

  async function send(link: string): Promise<void> {
    const text = `Shopping brought to your door with ${storeConfig.productName}: ${link}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: storeConfig.productName, text, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      onNews('Your link is copied. You can paste it into a message.');
    } catch {
      // They closed the share sheet: nothing to say.
    }
  }

  return (
    <section aria-labelledby="share-heading" className="space-y-3 max-w-xl">
      <h2 id="share-heading" className="text-lead font-bold">
        Your share link
      </h2>
      <p className="m-0 break-all">{share.link}</p>
      <p className="m-0">
        {share.joined === 1
          ? '1 person has joined with your link.'
          : `${share.joined} people have joined with your link.`}
      </p>
      <button
        type="button"
        onClick={() => {
          void send(share.link);
        }}
        className="control bg-highlight text-ink"
      >
        Share my link
      </button>
    </section>
  );
}
