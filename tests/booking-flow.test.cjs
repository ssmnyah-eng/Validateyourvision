// Run with node --test tests/booking-flow.test.cjs. No external requests or payments.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function page(file, search = '') {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const nodes = new Map();
  class Element {
    constructor() { this.style = {}; this.value = ''; this.children = []; this.listeners = {}; this.classes = new Set(); this.dataset = {}; }
    get classList() { return {
      add: (...xs) => xs.forEach(x => this.classes.add(x)),
      remove: (...xs) => xs.forEach(x => this.classes.delete(x)),
      contains: x => this.classes.has(x),
      toggle: (x, force = !this.classes.has(x)) => { force ? this.classes.add(x) : this.classes.delete(x); return force; }
    }; }
    set className(v) { this.classes = new Set(v.split(/\s+/)); }
    set innerHTML(v) { this.markup = v; this.children = []; }
    get innerHTML() { return this.markup || ''; }
    appendChild(x) { this.children.push(x); }
    removeChild(x) { this.children.splice(this.children.indexOf(x), 1); }
    get lastChild() { return this.children.at(-1); }
    querySelector() { return new Element(); }
    querySelectorAll() { return []; }
    addEventListener(name, cb) { this.listeners[name] = cb; }
    setAttribute() {}
    focus() { this.focused = true; }
    scrollIntoView() {}
  }
  for (const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const el = new Element();
    el.className = tag[0].match(/class="([^"]*)"/)?.[1] || '';
    nodes.set(tag[1], el);
  }
  const listeners = {};
  const document = {
    readyState: 'loading', body: new Element(),
    getElementById: id => nodes.get(id) || null,
    createElement: () => new Element(),
    querySelector: () => null,
    querySelectorAll: selector => selector === '.stop-card' ? nodes.get('stops-list').children : [],
    addEventListener: (name, cb) => (listeners[name] ||= []).push(cb)
  };
  const requests = [];
  const context = vm.createContext({ document, URLSearchParams, console,
    location: { search, href: '' }, innerWidth: 1200,
    addEventListener() {}, setTimeout() {}, setInterval() {}, clearInterval() {},
    IntersectionObserver: class { observe() {} unobserve() {} },
    fetch: (...args) => { requests.push(args); return Promise.resolve({ json: async () => ({ok: true, slots: {}}) }); },
    FormData: class { constructor(form) { this.form = form; } get(k) { return this.form.fields[k]; } }
  });
  context.window = context;
  const run = code => vm.runInContext(code, context);
  for (const script of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/src=|application\/ld\+json/.test(script[1])) run(script[2]);
  }
  (listeners.DOMContentLoaded || []).forEach(cb => cb());
  return { run, nodes, requests, context, Element };
}
function active(p, step) {
  assert.deepEqual([...p.nodes].filter(([id, el]) => /^step\d$/.test(id) && el.classList.contains('active')).map(([id]) => id), [`step${step}`]);
}

test('direct booking loads without a script error and starts at Step 1', () => {
  const p = page('book.html');
  active(p, 0);
  assert.equal(p.nodes.get('progressFill').style.width, '0%');
  p.run('goFromStep0()');
  active(p, 0);
  assert.equal(p.nodes.get('s0-first').focused, true);
});

test('homepage-prefilled and legacy skip URLs still begin at Step 1', () => {
  for (const skip of ['', '&skip=calendar', '&skip=map']) {
    const p = page('book.html', '?name=Test+Customer&email=test%40example.com&phone=5551234567&from=First+Street&to=Last+Street' + skip);
    active(p, 0);
    assert.equal(p.nodes.get('s0-last').value, 'Customer');
    assert.equal(p.nodes.get('s0-from').value, 'First Street');
  }
});

test('all seven sections, stop edits, and backward navigation work without Google or Stripe', () => {
  const p = page('book.html', '?name=Test+Customer&email=test%40example.com&phone=5551234567&from=First+Street&to=Last+Street');
  p.run('goFromStep0()'); active(p, 1);
  p.run('selectCrew(3)'); active(p, 2);
  p.run('selectDay(new Date(Date.now() + 86400000)); selectTime("AM"); goToDetails()'); active(p, 3);
  assert.equal(p.nodes.get('stops-list').children.length, 2);
  p.run('addStop(); setField(1, "address", "Storage Street"); addStop(); moveStop(1, 1)');
  assert.equal(p.nodes.get('stops-list').children.length, 4);
  assert.equal(p.run('stops[2].address'), 'Storage Street');
  p.run('deleteStop(1); selectPropType(1, "Storage")');
  assert.equal(p.run('stops[1].address'), 'Storage Street');
  assert.equal(p.run('stops[1].propType'), 'Storage');
  p.run('goToMoveInfo()'); active(p, 4);
  p.run('goToPackingStep()'); active(p, 5);
  p.run('goToFinalStep()'); active(p, 6);
  assert.equal(p.nodes.get('cf-first').value, 'Test');
  for (const [fn, step] of [['goBackToPacking',5],['goBackToMoveInfo',4],['goBackToDetails',3],['goBackToCalendar',2],['goBack',1],['goBackToContact',0]]) {
    p.run(`${fn}()`); active(p, step);
  }
});

test('autocomplete binds to replacement inputs after stops rerender', () => {
  const p = page('book.html');
  let attached = 0;
  p.context.google = { maps: { places: { Autocomplete: class { constructor() { attached++; } addListener() {} } } } };
  p.nodes.set('addr-0', new p.Element());
  p.run('attachPlaces("addr-0", 0); attachPlaces("addr-0", 0)');
  assert.equal(attached, 1);
  p.nodes.set('addr-0', new p.Element());
  p.run('attachPlaces("addr-0", 0)');
  assert.equal(attached, 2);
});

test('homepage validates missing details and passes valid details without skipping steps', async () => {
  const p = page('index.html');
  p.context.form = { reportValidity: () => false };
  await p.run('handleLeadFormSubmit({preventDefault(){}, target: form})');
  assert.equal(p.context.location.href, '');
  p.context.form = { reportValidity: () => true, fields: { name: 'Test Customer', email: 'test@example.com', phone: '5551234567', moving_from: 'First Street', moving_to: 'Last Street' } };
  await p.run('handleLeadFormSubmit({preventDefault(){}, target: form})');
  const dest = new URL(p.context.location.href, 'https://example.com');
  assert.equal(dest.pathname, '/book.html');
  assert.equal(dest.searchParams.get('from'), 'First Street');
  assert.equal(dest.searchParams.has('skip'), false);
});
