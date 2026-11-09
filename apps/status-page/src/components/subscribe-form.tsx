import { useReducer, type FormEvent } from 'react';
import { IconBell, IconCircleCheck } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Turnstile } from './turnstile';

const FAILED = 'Could not subscribe. Try again in a minute.';
const UNAVAILABLE = 'Email updates are unavailable. Try again later.';

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; email: string }
  | { status: 'error'; error: string };
type SubmitEvent =
  | { type: 'submit' }
  | { type: 'success'; email: string }
  | { type: 'failure'; error: string };
function step(state: SubmitState, event: SubmitEvent): SubmitState {
  if (event.type === 'submit') return state.status === 'success' ? state : { status: 'submitting' };
  if (state.status !== 'submitting') return state;
  return event.type === 'success'
    ? { status: 'success', email: event.email }
    : { status: 'error', error: event.error };
}

async function sendSubscription(fields: URLSearchParams): Promise<string | null> {
  try {
    const response = await fetch('/subscribe', { method: 'POST', body: fields });
    if (!response.ok) {
      if (!response.headers.get('Content-Type')?.startsWith('text/plain')) return FAILED;
      const message = (await response.text()).trim();
      return message && message.length <= 120 ? message : FAILED;
    }
    return null;
  } catch {
    return FAILED;
  }
}

export function SubscribeMenu({ siteKey }: { siteKey: string | null }) {
  const [state, dispatch] = useReducer(step, { status: 'idle' });
  const notice = state.status === 'error' ? state.error : siteKey === '' ? UNAVAILABLE : null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.status === 'submitting') return;
    const fields = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget))
      if (typeof value === 'string') fields.set(key, value);
    dispatch({ type: 'submit' });
    const error = await sendSubscription(fields);
    dispatch(
      error === null
        ? { type: 'success', email: fields.get('email') ?? '' }
        : { type: 'failure', error },
    );
  };

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
        <IconBell />
        <span className="max-sm:sr-only">Get updates</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        aria-labelledby="subscribe-title"
        className="max-w-(--available-width)"
      >
        <div className="flex w-75 max-w-full flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="subscribe-title" className="text-base font-medium text-foreground">
              Get updates by email
            </h2>
            <div className="grid text-sm">
              <p
                className={cn(
                  'col-start-1 row-start-1 text-muted-foreground',
                  notice && 'invisible',
                )}
              >
                When a monitor goes down or recovers.
              </p>
              {notice && (
                <p
                  id="subscribe-error"
                  role="alert"
                  className="col-start-1 row-start-1 text-destructive wrap-break-word"
                >
                  {notice}
                </p>
              )}
            </div>
          </div>
          {state.status === 'success' ? (
            <div
              ref={(node) => node?.focus()}
              role="status"
              tabIndex={-1}
              className="flex gap-2 text-sm outline-offset-4"
            >
              <IconCircleCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-status-operational-text"
              />
              <div className="min-w-0">
                <p className="font-medium text-foreground">Check your inbox</p>
                <p className="mt-1 text-muted-foreground wrap-anywhere">
                  We sent a link to <span className="text-foreground">{state.email}</span>.
                </p>
              </div>
            </div>
          ) : (
            <form
              action="/subscribe"
              method="post"
              className="flex flex-col gap-4"
              onSubmit={(event) => void submit(event)}
            >
              <Field>
                <FieldLabel htmlFor="subscriber-email">Email address</FieldLabel>
                <Input
                  id="subscriber-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  aria-describedby={notice ? 'subscribe-error' : undefined}
                />
              </Field>
              {siteKey && <Turnstile siteKey={siteKey} refresh={state.status === 'error'} />}
              <Button type="submit" disabled={state.status === 'submitting' || siteKey === ''}>
                {state.status === 'submitting' ? 'Subscribing…' : 'Subscribe'}
              </Button>
            </form>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
