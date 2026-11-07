import { expect, it } from 'vite-plus/test';
import {
  CONFIRMATION_NOTES,
  withConfirmationNote,
  withoutConfirmationNote,
} from '../../src/checkers/confirmation-note';

it('leaves the same failure text under either note, even when the error is cut', () => {
  const error = 'x'.repeat(600);
  const confirmed = withConfirmationNote(error, CONFIRMATION_NOTES.confirmed);
  const unconfirmed = withConfirmationNote(error, CONFIRMATION_NOTES.unconfirmed);

  expect(withoutConfirmationNote(confirmed)).toBe(withoutConfirmationNote(unconfirmed));
  expect(unconfirmed.length).toBe(500);
});

it('keeps an error that has no note', () => {
  expect(withoutConfirmationNote('Timeout')).toBe('Timeout');
});
