import { expect, it } from 'vite-plus/test';
import { replay, scenarios } from '../helpers/lifecycle-replay';
import baseline from '../fixtures/hub-lifecycle-logs.json';

for (const [name, sequence, options] of scenarios) {
  it('replays ' + name + ' through the public hub', () => {
    expect(replay(sequence, options)).toEqual(baseline.find((entry) => entry.name === name)?.log);
  });
}
