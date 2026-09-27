/** An error that changes every run would otherwise grow the row past the storage limit. */
const MAX_INCIDENT_SEGMENTS = 100;

/** The first segment, where the incident began, and the latest ones. */
export function capSegments<T>(segments: T[]): T[] {
  const [first, ...rest] = segments;
  if (first === undefined || rest.length < MAX_INCIDENT_SEGMENTS) return segments;
  return [first, ...rest.slice(1 - MAX_INCIDENT_SEGMENTS)];
}
