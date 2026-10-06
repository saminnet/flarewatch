import { describe, it, expect } from 'vite-plus/test';
import { configIssues } from '../src/config';
import type { JsonObject } from '../src/types';
import fixture from './fixtures/requests.json';

/** flarewatch-proxy runs the same file, so this shape is a contract between the repos. */
interface Case {
  name: string;
  body?: JsonObject;
  rawBody?: string;
  accepted: boolean;
  field?: string;
}

interface Disagreement {
  accept: boolean;
  fieldNamed?: boolean;
  reason: string;
}

/**
 * Cases where the monitor schema gives another result than the proxy. Each entry
 * holds the schema's result, so a change on either side fails the test.
 * `fieldNamed` says whether an issue names the field at fault.
 */
const DISAGREES = new Map<string, Disagreement>([
  [
    'accepted: a field name in another case is ignored',
    { accept: false, reason: 'the schema rejects an unknown field, the proxy ignores it' },
  ],
  [
    'method: HEARTBEAT',
    {
      accept: false,
      fieldNamed: false,
      reason: 'HEARTBEAT is a monitor type here, so the issues name its own fields',
    },
  ],
]);

const ORIGIN = 'http://127.0.0.1:9';

function expand(value: string): string {
  return value
    .replaceAll('{ORIGIN}', ORIGIN.toUpperCase())
    .replaceAll('{origin}', ORIGIN)
    .replaceAll('{tcp}', '127.0.0.1:9');
}

/** A case with `rawBody` is JSON text that never parses, and a config is not text. */
const cases = (fixture as Case[]).filter((each) => each.body !== undefined);

describe('requests.json through the monitor schema', () => {
  it.each(cases)('$name', ({ name, body, accepted, field }) => {
    const monitor: JsonObject = { id: 'test', name: 'Test', method: 'GET', ...body };
    if (typeof monitor.target === 'string') monitor.target = expand(monitor.target);
    const issues = configIssues({ monitors: [monitor] });
    const disagreement = DISAGREES.get(name);

    if (disagreement?.accept ?? accepted) {
      expect(issues).toEqual([]);
      return;
    }
    expect(issues).not.toEqual([]);
    if (field) {
      expect(issues.some((issue) => new RegExp(`\\b${field}\\b`).test(issue))).toBe(
        disagreement?.fieldNamed ?? true,
      );
    }
  });
});
