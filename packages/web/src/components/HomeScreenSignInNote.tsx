/**
 * One sentence for a Runner on an iPhone or iPad who is in the ordinary browser, not in the app
 * on the Home Screen (10 November 2026, ruling 100).
 *
 * There, the browser and the app on the Home Screen each keep what they remember apart, and no
 * code of ours can join the two. So somebody who signs in in the browser and then opens the app
 * from the Home Screen is asked to sign in again, and takes it for being signed out. Saying so
 * once, in plain words, is all that can be done. Nothing is shown anywhere else: not on other
 * phones, and not inside the Home Screen app itself.
 */

/** An iPhone or iPad, in a browser tab rather than opened from the Home Screen. */
export function inAppleBrowserTab(): boolean {
  try {
    const platform = navigator.platform ?? '';
    const appleMobile =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!appleMobile) return false;
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return !standalone;
  } catch {
    return false;
  }
}

export function HomeScreenSignInNote(): JSX.Element | null {
  if (!inAppleBrowserTab()) return null;
  return (
    <p className="m-0 max-w-xl">
      On an iPhone or iPad, the app on your Home Screen keeps its own sign-in, so sign in once
      there too.
    </p>
  );
}
