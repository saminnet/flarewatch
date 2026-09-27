/** Stands in for the workerd-only `cloudflare:workers` module under Node. */
export class DurableObject<Env = unknown> {
  constructor(
    protected readonly ctx: DurableObjectState,
    protected readonly env: Env,
  ) {}
}
