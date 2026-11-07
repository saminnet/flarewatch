const CONFIRMED = '(confirmed elsewhere)';
const UNCONFIRMED = '(no confirmation available)';

export type ConfirmationNote = typeof CONFIRMED | typeof UNCONFIRMED;
export const CONFIRMATION_NOTES = { confirmed: CONFIRMED, unconfirmed: UNCONFIRMED } as const;

/** Both notes cut the error at one length, so the same failure keeps the same text under either. */
export function withConfirmationNote(error: string, note: ConfirmationNote): string {
  return `${error.slice(0, 499 - UNCONFIRMED.length)} ${note}`;
}

export function withoutConfirmationNote(error: string): string {
  for (const note of [CONFIRMED, UNCONFIRMED]) {
    if (error.endsWith(` ${note}`)) return error.slice(0, -note.length - 1);
  }
  return error;
}
