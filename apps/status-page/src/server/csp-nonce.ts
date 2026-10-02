import { randomToken } from '@/lib/auth/flow';

const nonces = new WeakMap<Request, string>();

/** The router creates its script tags before the middleware sets the header, so both look the nonce up by request. */
export function cspNonce(request: Request): string {
  let nonce = nonces.get(request);
  if (nonce === undefined) {
    nonce = randomToken();
    nonces.set(request, nonce);
  }
  return nonce;
}
