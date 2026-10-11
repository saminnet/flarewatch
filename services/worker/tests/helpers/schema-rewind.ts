/**
 * What each migration step from 7 on adds to the schema, as the statements that undo it;
 * a step that only moves data adds nothing. A new step in src/hub/schema.ts gets its entry
 * here, and a rewind past a step missing from this list fails.
 */
const UNDO = new Map([
  [
    7,
    [
      'DROP TABLE incident_lists',
      'DROP TABLE latency',
      'ALTER TABLE incidents DROP COLUMN up_since',
    ],
  ],
  [
    8,
    [
      'ALTER TABLE meta DROP COLUMN runs',
      'ALTER TABLE incidents DROP COLUMN alert_run',
      'ALTER TABLE incidents DROP COLUMN reminders',
    ],
  ],
  [
    9,
    [
      'ALTER TABLE monitors DROP COLUMN failure_count',
      'ALTER TABLE monitors DROP COLUMN first_failure_at',
    ],
  ],
  [10, ['ALTER TABLE monitors DROP COLUMN warning', 'DROP TABLE expiry_alerts']],
  [11, ['DROP TABLE announcements']],
  [12, ['ALTER TABLE meta DROP COLUMN latest']],
  [13, ['DROP TABLE pending_recoveries']],
  [14, []],
  [
    15,
    ['ALTER TABLE incidents DROP COLUMN error_due', 'ALTER TABLE incidents DROP COLUMN error_run'],
  ],
]);

/** The schema step each release ended at. */
export const RELEASE_STEP = { '3.1.0': 6, '3.2.0': 7, '3.4.0': 13 } as const;

/**
 * The statements that take a hub migrated to `applied` back to the schema after step
 * `target`, so its next start runs the later steps again, as on an upgrade.
 */
export function rewindStatements(applied: number, target: number): string[] {
  const statements = [`DELETE FROM _migrations WHERE id > ${target}`];
  for (let step = applied; step > target; step--) {
    const undo = UNDO.get(step);
    if (!undo) {
      throw new Error(`tests/helpers/schema-rewind.ts does not list migration step ${step}`);
    }
    statements.push(...undo);
  }
  return statements;
}
