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
        const icon = item.icon
          ? (/^https?:\\/\\//.test(item.icon) ? item.icon : location.origin + item.icon)
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

function normalizeKindCandidates(listing) {
  const rawValues = [
    listing && listing.itemCategory,
    listing && listing.kind,
    listing && listing.type,
    listing && listing.category,
    listing && listing.slot
  ].filter(Boolean).map((v) => String(v).trim()).filter(Boolean);

  const candidates = new Set();
  const add = (value) => {
    if (!value) return;
    candidates.add(value);
  };

  for (const raw of rawValues) {
    add(raw);
    add(raw.toLowerCase());
    add(raw.toUpperCase());
  }

  for (const raw of rawValues) {
    const low = raw.toLowerCase();
    if (low.includes('pok') && low.includes('mon')) {
      ['pokemon', 'Pokemon', 'Pokémon'].forEach(add);
    } else if (low.includes('item')) {
      ['item', 'items', 'Item', 'Items'].forEach(add);
    } else if (low.includes('stone')) {
      ['stone', 'stones', 'Stone', 'Stones'].forEach(add);
    } else if (low.includes('ball')) {
      ['ball', 'balls', 'Poké Balls', 'Poke Balls'].forEach(add);
    } else if (low.includes('diamond')) {
      ['diamond', 'diamonds', 'Diamond', 'Diamonds'].forEach(add);
    }
  }

  if (!candidates.size) {
    add('item');
    add('Item');
  }

  return Array.from(candidates);
}

function buildBuyBody(listing, kindOverride) {
  const kind = kindOverride || listing.kind || listing.type || listing.category || listing.slot || null;
  const listingId = listing.listingId ?? listing.marketId ?? listing.id ?? null;
  const isStackListing = typeof listingId === 'string' && listingId.startsWith('st:');
  const refId = isStackListing
    ? listingId
    : (listing.refId ?? listing.referenceId ?? listing.uuid ?? listing.listingRef ?? null);
  const itemId = listing.itemId ?? listing.productId ?? listing.item?.id ?? listing.item?.itemId ?? null;
  const pokemonId = listing.pokemonId ?? listing.pokeInstanceId ?? listing.poke?.id ?? listing.pokemon?.id ?? null;
  const buyQuantity = Number(listing.buyQuantity ?? listing.selectedQuantity ?? 1);
  return {
    action: 'buy',
    currency: normalizeCurrency(listing.currency || listing.paymentCurrency || listing.moneyType),
    id: listingId,
    kind,
    listingId,
    marketId: listingId,
    itemId,
    pokemonId,
    price: listing.price,
    amount: listing.price,
    quantity: Number.isFinite(buyQuantity) && buyQuantity > 0 ? buyQuantity : 1,
    refId,
    stackKey: isStackListing ? listingId : null
  };
}

function compactBuyBody(body) {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined && value !== null));
}

function buildBuyBodies(listing, kindOverride) {
  const primary = buildBuyBody(listing, kindOverride);
  const listingId = listing.listingId ?? listing.marketId ?? listing.id ?? null;
  const isStackListing = typeof listingId === 'string' && listingId.startsWith('st:');
  if (!isStackListing) return [primary];

  const rawKind = String(kindOverride || primary.kind || listing.kind || '').toLowerCase();
  const singularKind = rawKind.includes('pok') ? 'pokemon' : 'item';
  const concreteRef = primary.itemId ?? primary.pokemonId ?? listing.refId ?? listing.referenceId ?? null;
  const bodies = [];

  if (concreteRef != null) {
    bodies.push(compactBuyBody({
      action: 'buy',
      currency: primary.currency,
      id: concreteRef,
      kind: singularKind,
      itemId: primary.itemId,
      pokemonId: primary.pokemonId,
      price: primary.price,
      amount: primary.amount,
      quantity: primary.quantity,
      refId: concreteRef
    }));

    bodies.push(compactBuyBody({
      action: 'buy',
      currency: primary.currency,
      kind: singularKind,
      itemId: primary.itemId,
      pokemonId: primary.pokemonId,
      price: primary.price,
      amount: primary.amount,
      quantity: primary.quantity,
      refId: concreteRef
    }));
  }

  return bodies;
}

function normalizeCurrency(currency) {
  const raw = String(currency || 'GOLD').trim().toUpperCase();
  if (raw.includes('DIAM')) return 'DIAMONDS';
  if (raw.includes('GOLD') || raw === '$' || raw.includes('DOLLAR')) return 'GOLD';
  return raw || 'GOLD';
}

function deriveMarketCategory(listing) {
  const raw = String(listing && (listing.category || listing.kind || listing.type || listing.slot || '')).toLowerCase();
  if (raw.includes('pok')) return 'Pokémon';
  if (raw.includes('stone')) return 'Stones';
  if (raw.includes('ball')) return 'Poké Balls';
  if (raw.includes('diamond')) return 'Diamonds';
  if (raw.includes('item')) return 'Items';
  return 'All';
}

function buyListingScripts(listing, kindOverride) {
  return buildBuyBodies(listing, kindOverride).map((body) => `(async () => {
    try {
      const res = await fetch('/api/game/market/action', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, ${AUTH_HEADER_JS}),
        body: ${JSON.stringify(JSON.stringify(body))}
      });
      let payload = null;
      const text = await res.text().catch(() => '');
      try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = text; }
      return { ok: res.ok, status: res.status, payload, requestBody: ${JSON.stringify(body)} };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), requestBody: ${JSON.stringify(body)} };
    }
  })();`);
}

function postBuySyncScript(listing) {
  const category = deriveMarketCategory(listing);
  const payload = {
    category,
    kind: listing && (listing.itemCategory || listing.kind || listing.category || listing.type || null),
    name: listing && (listing.name || listing.title || listing.speciesName || listing.itemName || listing.productName || null),
    listingId: listing && (listing.listingId ?? listing.marketId ?? listing.id ?? null),
    speciesId: listing && (listing.pokeId ?? listing.speciesId ?? listing.dexId ?? null),
    itemId: listing && (listing.itemId ?? listing.productId ?? (listing.item && listing.item.id) ?? null),
    boughtAt: Date.now()
  };
  return `(async () => {
    const report = {
      ok: true,
      category: ${JSON.stringify(category)},
      depotOpen: false,
      clickedTargetTab: false,
      clickedAltTab: false,
      eventsDispatched: 0
    };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .toLowerCase()
      .trim();
    const visible = (el) => {
      try {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      } catch (e) {
        return false;
      }
    };
    const textOf = (el) => normalize(
      el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || ''
    );
    const safeClick = (el) => {
      if (!el || !visible(el)) return false;
      try {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        el.click();
        return true;
      } catch (e) {
        return false;
      }
    };
    try {
      const marker = JSON.stringify(${JSON.stringify(payload)});
      try {
        sessionStorage.setItem('nexa:last-market-buy', marker);
        localStorage.setItem('nexa:last-market-buy', marker);
      } catch (e) {}
      // 'online' and 'visibilitychange' are intentionally excluded: they trigger
      // game WebSocket reconnection, which resets in-flight state and causes
      // spurious "session expired" errors after a purchase.
      const wakeEvents = [
        () => window.dispatchEvent(new Event('focus')),
        () => window.dispatchEvent(new Event('resize')),
        () => window.dispatchEvent(new CustomEvent('nexa-market-purchase', { detail: ${JSON.stringify(payload)} }))
      ];
      for (const emit of wakeEvents) {
        try { emit(); report.eventsDispatched += 1; } catch (e) {}
      }

      const bodyText = normalize(document.body && document.body.innerText);
      report.depotOpen = bodyText.includes('depot') && (
        bodyText.includes('store all') ||
        bodyText.includes('nothing in the depot') ||
        bodyText.includes('familia') ||
        bodyText.includes('bag')
      );
      if (!report.depotOpen) return report;

      const clickables = Array.from(document.querySelectorAll('button,[role="tab"],[tabindex],a'))
        .filter((el) => visible(el));
      const isPokemon = ${JSON.stringify(category)} === 'PokÃ©mon';
      const nexaIsPokemon = normalize(${JSON.stringify(category)}).includes('pokemon') ||
        normalize(${JSON.stringify(payload.kind)}).includes('pokemon') ||
        ${payload.speciesId != null ? 'true' : 'false'};
      const targetWords = nexaIsPokemon ? ['pokemon'] : ['items', 'item', 'bag'];
      const altWords = nexaIsPokemon ? ['items', 'item', 'bag'] : ['pokemon'];
      const findByWords = (words) => clickables.find((el) => {
        const text = textOf(el);
        return words.some((word) => text.includes(word));
      });
      const targetTab = findByWords(targetWords);
      const altTab = findByWords(altWords);

      // Toggle away and back when possible. The game owns the real Depot state;
      // this only nudges its own React handlers instead of drawing fake entries.
      if (altTab && targetTab && altTab !== targetTab) {
        report.clickedAltTab = safeClick(altTab);
        if (report.clickedAltTab) await sleep(140);
      }
      report.clickedTargetTab = safeClick(targetTab);
      await sleep(220);
      for (const emit of wakeEvents) {
        try { emit(); report.eventsDispatched += 1; } catch (e) {}
      }
      await sleep(220);
      window.dispatchEvent(new CustomEvent('nexa-market-purchase-after-tab', { detail: ${JSON.stringify(payload)} }));
      return report;
    } catch (e) {
      return { ...report, ok: false, error: String((e && e.message) || e) };
    }
  })();`;
}

module.exports = { MARKET_CATEGORIES, fetchListingsScript, buyListingScripts, postBuySyncScript, normalizeKindCandidates, deriveMarketCategory, normalizeCurrency, buildBuyBodies };
