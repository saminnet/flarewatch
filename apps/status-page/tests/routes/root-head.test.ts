import { describe, expect, it } from 'vite-plus/test';
import { Route } from '@/routes/__root';

type Meta = { name?: string; property?: string; content?: string };
type Head = (ctx: { loaderData?: { title: string } }) => { meta?: Meta[] };

function previewTags(title: string) {
  const head = Route.options.head as Head;
  const meta = head({ loaderData: { title } }).meta ?? [];
  return Object.fromEntries(
    meta.flatMap((tag) => {
      const key = tag.property ?? tag.name;
      return key ? [[key, tag.content]] : [];
    }),
  );
}

describe('root route head', () => {
  it('names the configured page in its link-preview tags', () => {
    expect(previewTags('Acme status')).toMatchObject({
      description: 'Live status, uptime and incident history for Acme status.',
      'og:title': 'Acme status',
      'og:site_name': 'Acme status',
      'og:description': 'Live status, uptime and incident history for Acme status.',
    });
  });
});
