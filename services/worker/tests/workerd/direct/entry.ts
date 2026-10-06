import type { MonitorTarget } from '@flarewatch/shared';
import { checkMonitor, runBudget } from '../../../src/checkers/index';
import { defaultCheckDeps } from '../../../src/checkers/deps';

// The default asks Cloudflare over the network where the Worker runs.
const deps = { ...defaultCheckDeps, getEdgeLocation: async () => 'TEST' };

export default {
  async fetch(request: Request): Promise<Response> {
    const monitor: MonitorTarget = await request.json();
    const { result } = await checkMonitor(
      monitor,
      { env: {}, budget: runBudget([monitor], 0) },
      deps,
    );
    return Response.json(result);
  },
};
