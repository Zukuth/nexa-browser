// @ts-check
// Sell-lock: hard-blocks selling specific caught Pokémon (by their unique
// instance id) or specific item types (by name) the user picked, instead of
// PokeGrid's approach of just popping a confirm() the user can click through.
// The game sells via plain fetch() to /api/game/pokemon/sell (body:
// {pokeIds:[...]}) and /api/game/(shop|flint)/sell (body: {items:[{itemId,qty}]}
// or {itemId,qty}) — confirmed live via DevTools. Filters the locked entries
// out of the request body (letting an otherwise-mixed sell of unlocked items
// still go through) and only rejects the fetch outright if every entry in it
// was locked. Idempotent monkey-patch guarded by window.__nexaSellLock so
// repeated calls (toggling the lock list) just update the live sets instead
// of wrapping fetch twice.
function sellLockScript(pokeIds, itemIds) {
  return `(function() {
    const pokeSet = new Set(${JSON.stringify((pokeIds || []).map(String))});
    const itemSet = new Set(${JSON.stringify((itemIds || []).map(Number))});
    if (window.__nexaSellLock) {
      window.__nexaSellLock.pokeSet = pokeSet;
      window.__nexaSellLock.itemSet = itemSet;
      return;
    }
    window.__nexaSellLock = { pokeSet, itemSet };
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
      // Set as soon as we know this request IS a sell that the lock cares
      // about, before anything that can throw — see the catch below.
      let lockedSellEndpoint = false;
      try {
        const url = (input && input.url) || input;
        if (typeof url === 'string' && init && typeof init.body === 'string') {
          lockedSellEndpoint =
            (/\\/api\\/game\\/pokemon\\/sell/.test(url) && window.__nexaSellLock.pokeSet.size > 0) ||
            (/\\/api\\/game\\/(shop|flint)\\/sell/.test(url) && window.__nexaSellLock.itemSet.size > 0);
          if (/\\/api\\/game\\/pokemon\\/sell/.test(url)) {
            const body = JSON.parse(init.body);
            const ids = body.pokeIds || [];
            const allowed = ids.filter((id) => !window.__nexaSellLock.pokeSet.has(String(id)));
            if (allowed.length !== ids.length) {
              if (!allowed.length) return Promise.reject(new Error('Venta bloqueada por el candado de Nexa'));
              init = { ...init, body: JSON.stringify({ ...body, pokeIds: allowed }) };
            }
          } else if (/\\/api\\/game\\/(shop|flint)\\/sell/.test(url)) {
            const body = JSON.parse(init.body);
            const items = body.items ? body.items : (body.itemId != null ? [{ itemId: body.itemId, qty: body.qty }] : []);
            const allowed = items.filter((it) => !window.__nexaSellLock.itemSet.has(Number(it.itemId)));
            if (allowed.length !== items.length) {
              if (!allowed.length) return Promise.reject(new Error('Venta bloqueada por el candado de Nexa'));
              const newBody = body.items ? { ...body, items: allowed } : { itemId: allowed[0].itemId, qty: allowed[0].qty };
              init = { ...init, body: JSON.stringify(newBody) };
            }
          }
        }
      } catch (e) {
        // Used to swallow and send the ORIGINAL request through — a
        // protective feature failing OPEN, silently. The realistic trigger is
        // a game update changing the sell payload shape, which is exactly
        // when a locked Pokémon/item would get sold anyway. If the body
        // couldn't be parsed there's no way to know whether something locked
        // is inside it, so the lock blocks instead of guessing. Only when
        // something is actually locked (see lockedSellEndpoint) — an empty
        // lock list must never block a normal sale.
        if (lockedSellEndpoint) {
          console.error('[nexa-sell-lock] no se pudo verificar esta venta, se bloquea por seguridad', e);
          return Promise.reject(new Error('Venta bloqueada por el candado de Nexa (no se pudo verificar la venta)'));
        }
      }
      return originalFetch.call(this, input, init);
    };
  })();`;
}

module.exports = { sellLockScript };
