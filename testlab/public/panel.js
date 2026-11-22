'use strict';

// All text is written with textContent / append, never innerHTML.
const KEY = 'uptimehq-testlab-password';
const $ = (id) => document.getElementById(id);
let data;
let messageTimer;

function el(tag, props, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function say(text, error = false) {
  clearTimeout(messageTimer);
  $('message').textContent = text;
  $('message').className = error ? 'error' : '';
  messageTimer = setTimeout(() => ($('message').textContent = ''), 3000);
}

async function call(path, body) {
  const res = await fetch(`/testlab/control/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Lab-Password': sessionStorage.getItem(KEY) ?? '' },
    body: body && JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
  if (res.status === 401) {
    sessionStorage.removeItem(KEY);
    data = undefined;
    $('panel').hidden = true;
    $('login').hidden = false;
  }
  if (!res.ok) throw new Error(json.error);
  return json;
}

function copyButton(value, label = 'Copy') {
  return el('button', {
    type: 'button',
    textContent: label,
    onclick: () =>
      navigator.clipboard.writeText(value).then(
        () => say('Copied'),
        () => say('Could not copy; select the text instead', true),
      ),
  });
}

async function change(path, body, done) {
  try {
    await call(path, body);
    await load();
    say(done);
  } catch (err) {
    say(err.message, true);
  }
}

function line(label, value) {
  return el('div', { className: 'line' }, el('span', { textContent: label }), el('code', { textContent: value }), copyButton(value));
}

function customEditor(id, custom) {
  const status = el('input', { id: `${id}-status`, type: 'number', min: 200, max: 599, value: custom.status });
  const delay = el('input', { id: `${id}-delay`, type: 'number', min: 0, max: 35000, value: custom.delayMs });
  const body = el('textarea', { id: `${id}-body`, rows: 1, maxLength: 4000, value: custom.body });
  const field = (text, input, className = '') => el('div', { className }, el('label', { htmlFor: input.id, textContent: text }), input);
  const save = el('button', {
    type: 'button',
    className: 'primary',
    textContent: 'Save response',
    onclick: () =>
      change('set', { id, mode: 'custom', custom: { status: Number(status.value), delayMs: Number(delay.value), body: body.value } }, 'Custom response saved'),
  });
  return el('div', { className: 'custom' }, field('Status', status), field('Delay (ms)', delay), field('Body', body, 'wide'), save);
}

function endpointRow([id, endpoint]) {
  const modes = id === 'token' ? data.tokenModes : data.modes;
  const { mode, custom } = data.current[id];
  const url = `${data.publicUrl}/e/${id}`;

  const select = el('select', { ariaLabel: `Behaviour of ${endpoint.name}` });
  const groups = new Map();
  for (const [key, m] of Object.entries(modes)) {
    if (!groups.has(m.group)) groups.set(m.group, select.appendChild(el('optgroup', { label: m.group })));
    groups.get(m.group).append(el('option', { value: key, textContent: m.label }));
  }
  select.value = mode;
  select.onchange = () =>
    change('set', { id, mode: select.value, custom: select.value === 'custom' ? custom : undefined }, `${endpoint.name}: ${modes[select.value].label}`);

  const up = modes[mode].group === 'Up' || (mode === 'custom' && custom.status < 400);
  const tone = mode === 'flapping' || mode === 'stall' ? 'mixed' : up ? '' : 'down';

  const row = el(
    'div',
    { className: 'item' },
    el('span', { className: `dot ${tone}`, title: tone === 'down' ? 'Down' : tone ? 'Varies' : 'Up' }),
    el('div', { className: 'name' }, el('strong', { textContent: endpoint.name }), el('code', { textContent: url })),
    copyButton(url, 'Copy URL'),
    select,
  );
  if (mode === 'custom') row.append(customEditor(id, custom));
  return row;
}

function renderRecent() {
  const items = data.recent.map((r) =>
    el('li', { textContent: `${new Date(r.at).toLocaleTimeString()}  ${r.method} ${r.path} → ${r.status ?? 'waiting'} (${r.note})` }),
  );
  $('recent').replaceChildren(...(items.length ? items : [el('li', { textContent: 'No requests yet.' })]));
}

function render() {
  $('login').hidden = true;
  $('panel').hidden = false;
  $('endpoints').replaceChildren(...Object.entries(data.endpoints).map(endpointRow));
  $('fixed').replaceChildren(
    ...Object.entries(data.modes)
      .filter(([, m]) => m.expect && m.expect !== 'SUCCESS')
      .map(([key, m]) => line(m.label, `${data.publicUrl}/s/${key}`)),
    ...Object.entries(data.tokenModes)
      .filter(([, m]) => !m.action)
      .map(([key, m]) => line(`Token URL: ${m.label}`, `${data.publicUrl}/t/${key}`)),
  );
  const c = data.credentials;
  $('credentials').replaceChildren(
    line('Bearer token', c.BEARER.token),
    line('Basic username', c.BASIC.username),
    line('Basic password', c.BASIC.password),
    line(`API key (${c.API_KEY.headerName})`, c.API_KEY.value),
    ...c.CUSTOM_HEADERS.headers.map((h) => line(`Header ${h.name}`, h.value)),
    line('OAuth2 client ID', c.OAUTH2_CLIENT_CREDENTIALS.clientId),
    line('OAuth2 client secret', c.OAUTH2_CLIENT_CREDENTIALS.clientSecret),
    line('OAuth2 token URL', `${data.publicUrl}/e/token`),
  );
  renderRecent();
}

async function load() {
  data = await call('state');
  render();
}

$('login').onsubmit = (event) => {
  event.preventDefault();
  sessionStorage.setItem(KEY, $('password').value);
  load().then(() => ($('password').value = ''), (err) => say(err.message, true));
};
$('all-up').onclick = () => change('all', { healthy: true }, 'Everything is healthy');
$('all-down').onclick = () => change('all', { healthy: false }, 'Everything is down');
$('revoke').onclick = () => change('revoke', {}, 'OAuth2 tokens revoked');

// Refresh only the request log, so open dropdowns and half-typed values are left alone.
setInterval(async () => {
  if (!data || document.hidden) return;
  try {
    data.recent = (await call('state')).recent;
    renderRecent();
  } catch (err) {
    say(err.message, true);
  }
}, 4000);

if (sessionStorage.getItem(KEY)) load().catch((err) => say(err.message, true));
