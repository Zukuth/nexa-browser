// Poke Idle World market helpers used by the renderer through executeJavaScript.
// Browsing and buying run inside the account's own webview so they reuse the
// same authenticated session the game already has.

const MARKET_CATEGORIES = ['All', 'Items', 'Stones', 'Poké Balls', 'Diamonds', 'Pokémon'];

const AUTH_HEADER_JS = `(() => {
  try {
    const raw = sessionStorage.getItem('pokeweb:tokens');
    const tok = raw && JSON.parse(raw);
    return tok && tok.accessToken ? { Authorization: 'Bearer ' + tok.accessToken } : {};
  } catch (e) { return {}; }
})()`;

// Confirmed live (a temporary debug log, since removed): GET
// /api/game/market?category=X returns EVERY listing in one response — no
// page/limit/offset param is sent, and the payload has no pagination field
// at all (checked its top-level keys: charId, listings, mine, requests,
// myRequests, offersIn, myOffers, history, blacklist, catalog — nothing
// page-shaped). Confirmed with real numbers: category=All returned 11,489
// listings, category=Items returned ~2,300, both in a single call. So
// nothing needs to be fetched again here — the renderer-side render cap
// (see renderMarketResults in src/renderer.js) is what was hiding results,
// not this fetch.
function fetchListingsScript(category) {
  const cat = MARKET_CATEGORIES.includes(category) ? category : 'All';
  return `(async () => {
    try {
      const normalizeText = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .toLowerCase()
        .trim();
      const itemCatalogPromise = fetch('/game/items.json')
        .then((r) => r.ok ? r.json() : null)
        .catch(() => null);
      const headers = ${AUTH_HEADER_JS};
      const loadCategory = async (categoryName) => {
        const res = await fetch('/api/game/market?category=' + encodeURIComponent(categoryName), { headers });
        if (!res.ok) return { ok: false, status: res.status, listings: [] };
        const data = await res.json();
        return { ok: true, listings: Array.isArray(data.listings) ? data.listings : [] };
      };
      let marketData = await loadCategory(${JSON.stringify(cat)});
      if (!marketData.ok) return { ok: false, status: marketData.status };
      if (${JSON.stringify(cat)} !== 'All' && marketData.listings.length === 0) {
        const fallbackData = await loadCategory('All');
        if (fallbackData.ok && fallbackData.listings.length) marketData = fallbackData;
      }
      const catalog = await itemCatalogPromise;
      const items = Array.isArray(catalog && catalog.items) ? catalog.items : [];
      const byId = new Map();
      const byName = new Map();
      for (const item of items) {
        if (!item || item.id == null) continue;
        // Same three-shape icon resolution already fixed in game-telemetry.js
        // for the Drops en vivo panel (confirmed live back then: 294/295
        // items.json entries are a bare filename needing an /assets/items/
        // prefix, not just location.origin + filename with no separating
        // slash — that produced a malformed, silently-404ing URL). This copy
        // never got the same fix, which is why Market global icons broke too.
        const icon = item.icon
          ? (/^https?:\\/\\//.test(item.icon)
              ? item.icon
              : item.icon.startsWith('/')
                ? location.origin + item.icon
                : location.origin + '/assets/items/' + item.icon)
          : null;
        const normalized = { ...item, icon, iconUrl: icon, image: icon };
        byId.set(Number(item.id), normalized);
        if (item.name) byName.set(normalizeText(item.name), normalized);
      }
      const resolveItem = (listing) => {
        const ids = [
          listing && listing.itemId,
          listing && listing.productId,
          listing && listing.item && listing.item.id,
          listing && listing.item && listing.item.itemId
        ].map(Number).filter(Number.isFinite);
        for (const id of ids) {
          if (byId.has(id)) return byId.get(id);
        }
        const name = normalizeText(
          (listing && (listing.itemName || listing.productName || listing.name || listing.title || listing.label)) || ''
        );
        if (!name) return null;
        if (byName.has(name)) return byName.get(name);
        const nameTokens = name.split(/[^a-z0-9]+/).filter((part) => part.length > 2);
        if (nameTokens.length >= 2) {
          for (const [candidateName, item] of byName.entries()) {
            const candidateTokens = candidateName.split(/[^a-z0-9]+/).filter((part) => part.length > 2);
            if (nameTokens.every((token) => candidateTokens.includes(token))) return item;
          }
        }
        return null;
      };
      const listings = marketData.listings.map((listing) => {
        const rawKind = normalizeText(listing && (listing.kind || listing.category || listing.type || listing.slot || ''));
        const isPokemonListing = rawKind.includes('pok') && rawKind.includes('mon');
        if (isPokemonListing) return listing;
        const item = resolveItem(listing);
        if (!item) return listing;
        return {
          ...listing,
          itemId: listing.itemId ?? item.id,
          icon: listing.icon || item.icon,
          iconUrl: listing.iconUrl || item.icon,
          image: listing.image || item.icon,
          itemCatalogName: item.name,
          itemCategory: item.category,
          itemDescription: item.description
        };
      });
      return { ok: true, listings };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  })();`;
}

// Only used now by the Alertas market-IV notification path (main.js's
// showMarketIvNotification/marketAlertId) — the browse/buy/sell/shop/depot
// UI this module used to also support was removed along with the Market,
// Tienda, Venta masiva and Depot tabs.
function normalizeCurrency(currency) {
  const raw = String(currency || 'GOLD').trim().toUpperCase();
  if (raw.includes('DIAM')) return 'DIAMONDS';
  if (raw.includes('GOLD') || raw === '$' || raw.includes('DOLLAR')) return 'GOLD';
  return raw || 'GOLD';
}

module.exports = { MARKET_CATEGORIES, fetchListingsScript, normalizeCurrency };
