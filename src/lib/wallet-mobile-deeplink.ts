const MOBILE_UA_RE = /android|iphone|ipad|ipod/i;

export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return MOBILE_UA_RE.test(navigator.userAgent);
}

export function hasInjectedPhantomProvider(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & {
    phantom?: { solana?: { isPhantom?: boolean } };
    solana?: { isPhantom?: boolean };
  };
  return Boolean(w.phantom?.solana?.isPhantom || w.solana?.isPhantom);
}

export function openPhantomMobileApp(): void {
  if (typeof window === 'undefined') return;
  const currentUrl = window.location.href;
  const refUrl = window.location.origin;
  const deepLink = `https://phantom.app/ul/browse/${encodeURIComponent(currentUrl)}?ref=${encodeURIComponent(refUrl)}`;
  window.location.assign(deepLink);
}

export function shouldOpenPhantomMobileDeepLink(): boolean {
  return isMobileBrowser() && !hasInjectedPhantomProvider();
}
