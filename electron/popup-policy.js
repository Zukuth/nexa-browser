// @ts-check
// Which destinations an account page is allowed to window.open() to.
//
// Extracted from main.js (same rule as url-utils.js / address-bar.js /
// sell-lock.js): this is a pure origin policy that decides whether a page
// running untrusted third-party game code gets a real, session-sharing popup
// window, and it was unreachable from a test while it lived inside main.js.
//
// window.open() popups get allowed through only when they go to the account's
// own site or a well-known third-party login provider — anything else is
// denied and logged. Before this existed, every account on every page could
// window.open() to literally anywhere and still receive a fully
// isolated+sandboxed+contextIsolated popup window; scoping the *destination*
// closes the remaining gap without breaking real Google/Facebook/Discord
// "sign in with..." flows, which is the only legitimate reason a game page
// needs a popup at all.
const POPUP_ALLOWED_HOSTS = new Set([
  'accounts.google.com',
  'accounts.youtube.com',
  'www.facebook.com',
  'm.facebook.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
  'discord.com',
  'twitter.com',
  'x.com',
  'api.twitter.com'
]);

function hostMatchesPopupAllowlist(hostname, accountHostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  // Same site (or a subdomain of it) opening a popup to itself — e.g. a
  // "share"/"support" window the game itself spawns.
  const account = accountHostname ? String(accountHostname).toLowerCase() : '';
  if (account && (h === account || h.endsWith(`.${account}`))) return true;
  // Walks up the domain so a subdomain of an allowlisted host (e.g.
  // eu.accounts.google.com) matches, while a lookalike that merely ENDS with
  // one as a substring (e.g. evil-accounts.google.com.attacker.test) does not:
  // each step starts at a real label boundary.
  let walk = h;
  while (walk.includes('.')) {
    if (POPUP_ALLOWED_HOSTS.has(walk)) return true;
    walk = walk.slice(walk.indexOf('.') + 1);
  }
  return POPUP_ALLOWED_HOSTS.has(walk);
}

module.exports = { hostMatchesPopupAllowlist, POPUP_ALLOWED_HOSTS };
