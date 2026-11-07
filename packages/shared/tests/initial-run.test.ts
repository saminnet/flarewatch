import { expect, it } from 'vite-plus/test';
import { initialRunStatus } from '../src/initial-run';

it('expires a claim at sixty seconds but keeps it at fifty-nine', () => {
  expect(initialRunStatus('0', '100000', 159000)).toEqual({
    status: 'run-claimed',
  });
  expect(initialRunStatus('0', '100000', 160000)).toEqual({ status: 'no-run' });
});

it('a recorded run never claims even after the claim expires', () => {
  expect(initialRunStatus('100', '100000', 160000)).toEqual({
    status: 'run-recorded',
  });
  expect(initialRunStatus('100', '159999', 160000)).toEqual({
    status: 'run-recorded',
  });
});

it('corrupt and empty meta values do not throw or block a claim', () => {
  for (const value of [undefined, '', ' ', 'garbage', 'NaN', 'Infinity', '-1', '0']) {
    expect(initialRunStatus(value, value, 1000)).toEqual({ status: 'no-run' });
  }
});
