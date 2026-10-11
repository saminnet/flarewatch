import type { JsonObject } from '@flarewatch/shared';

export function finishedMeasurement(
  result: JsonObject = {},
  probe: JsonObject = { country: 'FI', city: 'Helsinki' },
): JsonObject {
  return {
    status: 'finished',
    results: [
      {
        probe,
        result: {
          status: 'finished',
          statusCode: 200,
          rawBody: 'ok',
          timings: { total: 12.6 },
          ...result,
        },
      },
    ],
  };
}
