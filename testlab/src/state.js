import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENDPOINTS, modesFor } from './catalogue.js';

export class InputError extends Error {}

const defaults = () => ({ mode: 'healthy', custom: { status: 200, delayMs: 0, body: '{"ok":true}' } });

function parseCustom(input) {
  const status = Number(input?.status);
  const delayMs = Number(input?.delayMs);
  const body = input?.body;
  if (!Number.isInteger(status) || status < 200 || status > 599) throw new InputError('Status must be between 200 and 599');
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 35_000) throw new InputError('Delay must be between 0 and 35000 ms');
  if (typeof body !== 'string' || body.length > 4000) throw new InputError('Body must be text of at most 4000 characters');
  return { status, delayMs, body };
}

/** Switch positions, kept in a JSON file so they survive restarts and deploys. */
export function createState(dataDir) {
  const file = join(dataDir, 'state.json');
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(file, 'utf8')) ?? {};
  } catch {
    // First start, or an unreadable file: everything starts healthy.
  }

  const endpoints = {};
  for (const id of Object.keys(ENDPOINTS)) {
    const s = saved.endpoints?.[id];
    endpoints[id] = defaults();
    if (s && Object.hasOwn(modesFor(id), s.mode)) endpoints[id].mode = s.mode;
    try {
      if (s?.custom) endpoints[id].custom = parseCustom(s.custom);
    } catch {
      // Keep the default custom response.
    }
  }
  let generation = Number.isInteger(saved.generation) ? saved.generation : 1;

  const save = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify({ endpoints, generation }));
    renameSync(`${file}.tmp`, file);
  };

  return {
    endpoints,
    get generation() {
      return generation;
    },
    set(id, { mode, custom } = {}) {
      if (!Object.hasOwn(ENDPOINTS, id)) throw new InputError('Unknown endpoint');
      if (typeof mode !== 'string' || !Object.hasOwn(modesFor(id), mode)) throw new InputError('Unknown mode');
      const parsed = mode === 'custom' ? parseCustom(custom ?? endpoints[id].custom) : endpoints[id].custom;
      endpoints[id] = { mode, custom: parsed };
      save();
    },
    setAll(healthy) {
      for (const id of Object.keys(ENDPOINTS)) {
        endpoints[id].mode = healthy ? 'healthy' : id === 'token' ? 'unavailable' : '503';
      }
      save();
    },
    revokeTokens() {
      generation++;
      save();
    },
  };
}
