/* Shared address suggestions. The key is a browser API key, restricted by domain in Geoapify. */
(function () {
  const API_KEY = '524b8790bf1d4e2bb25fd73e97af1e63';
  const cache = new Map();
  function attach(input, onSelect) {
    if (!input || input.dataset.addressAutocomplete) return;
    input.dataset.addressAutocomplete = 'true';
    input.autocomplete = 'off';
    input.parentElement.style.position = 'relative';
    const wrap = document.createElement('div');
    wrap.className = 'vyv-address-results';
    wrap.id = input.id + '-suggestions';
    wrap.setAttribute('role', 'listbox');
    wrap.hidden = true;
    input.insertAdjacentElement('afterend', wrap);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', wrap.id);
    input.setAttribute('aria-expanded', 'false');
    let timer, controller, version = 0, active = -1, choices = [];
    function close() {
      wrap.hidden = true; active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    function choose(index) {
      const item = choices[index];
      if (!item) return;
      ++version;
      clearTimeout(timer);
      controller?.abort();
      input.value = item.formatted;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      clearTimeout(timer); ++version;
      close();
      onSelect?.(item.formatted, item);
    }
    function show(results) {
      choices = results.filter(r => r.formatted);
      wrap.replaceChildren(); active = -1;
      choices.forEach((item, index) => {
        const option = document.createElement('div');
        option.className = 'vyv-address-option';
        option.id = wrap.id + '-' + index;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.textContent = item.formatted;
        option.addEventListener('mousedown', e => e.preventDefault());
        option.addEventListener('click', () => choose(index));
        wrap.appendChild(option);
      });
      const credit = document.createElement('div');
      credit.className = 'vyv-address-credit';
      credit.innerHTML = 'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>';
      wrap.appendChild(credit);
      wrap.hidden = choices.length === 0;
      input.setAttribute('aria-expanded', String(choices.length > 0));
    }
    input.addEventListener('input', () => {
      const query = input.value.trim();
      const current = ++version;
      clearTimeout(timer); controller?.abort(); close();
      if (query.length < 3 || !input.isConnected) return;
      timer = setTimeout(async () => {
        try {
          if (cache.has(query)) { show(cache.get(query)); return; }
          controller = new AbortController();
          const params = new URLSearchParams({ text: query, filter: 'countrycode:us', bias: 'proximity:-77.46,38.30', format: 'json', limit: '5', apiKey: API_KEY });
          const response = await fetch('https://api.geoapify.com/v1/geocode/autocomplete?' + params, { signal: controller.signal });
          if (!response.ok) throw new Error('Address suggestions unavailable');
          const data = await response.json();
          if (current !== version || !input.isConnected) return;
          cache.set(query, data.results || []);
          if (cache.size > 100) cache.delete(cache.keys().next().value);
          show(data.results || []);
        } catch (error) {
          // Manual address entry remains available when the service is unavailable.
          if (current === version) close();
        }
      }, 350);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { close(); return; }
      if (wrap.hidden || !choices.length) return;
      if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); return; }
      if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
      [...wrap.querySelectorAll('[role="option"]')].forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
      input.setAttribute('aria-activedescendant', wrap.id + '-' + active);
    });
    input.addEventListener('blur', () => { ++version; clearTimeout(timer); controller?.abort(); setTimeout(close, 150); });
  }
  const geocodes = new Map();
  async function request(path, params) {
    const response = await fetch('https://api.geoapify.com/v1/' + path + '?' + new URLSearchParams({...params, apiKey: API_KEY}), {signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('Location service unavailable');
    return response.json();
  }
  async function geocode(address) {
    if (geocodes.has(address)) return geocodes.get(address);
    const data = await request('geocode/search', {text: address, filter: 'countrycode:us', format: 'json', limit: '1'});
    const point = data.results?.[0];
    if (!point) throw new Error('Please check your complete street address');
    const value = point.lat + ',' + point.lon;
    geocodes.set(address, value);
    return value;
  }
  async function routeMiles(from, to) {
    const points = await Promise.all([geocode(from), geocode(to)]);
    const route = await request('routing', {waypoints: points.join('|'), mode: 'drive'});
    const meters = route.features?.[0]?.properties?.distance;
    if (!Number.isFinite(meters)) throw new Error('Route distance unavailable');
    return Math.round(meters / 1609.34);
  }
  window.VYVAddresses = { attach, routeMiles };
})();
