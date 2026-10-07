/** Stands in for the workerd-only `cloudflare:workers` module under Node. */
type Bindings = {
  MONITOR_WORKER?: { fetch: (input: Request | string, init?: RequestInit) => Promise<Response> };
};

export const env: Bindings = {};

export class DurableObject<Env = unknown> {
  constructor(
    protected readonly ctx: DurableObjectState,
    protected readonly env: Env,
  ) {}
}
