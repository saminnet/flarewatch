import { createFileRoute } from '@tanstack/react-router';
import type { Announcement, Maintenance, StatusView } from '@flarewatch/shared';
import { getConfig } from '@/lib/config';
import { readVisitorSnapshot } from '@/lib/snapshots';
import type { PublicMonitor } from '@/lib/public-view';
import { escapeXml } from '@/lib/xml';

const MAX_ENTRIES = 50;

type FeedEntry = {
  id: string;
  title: string;
  content: string;
  when: number;
  updated: number;
  link: string;
};

const iso = (ms: number) => new Date(ms).toISOString();

function tagId(host: string, kind: string, key: string, when: number): string {
  return `tag:${host},${new Date(when).getUTCFullYear()}:${kind}/${encodeURIComponent(key)}`;
}

type FeedInput = {
  monitors: PublicMonitor[];
  state: StatusView | null;
  maintenances: Maintenance[];
  announcements: Announcement[];
  origin: string;
  host: string;
  title: string;
};

function incidentEntries(input: FeedInput): FeedEntry[] {
  if (!input.state) return [];
  const entries: FeedEntry[] = [];
  for (const monitor of input.monitors) {
    const incidents = input.state.monitors[monitor.id]?.incidents ?? [];
    for (const incident of incidents) {
      const start = incident.start[0];
      if (start === undefined) continue;
      const end = incident.end;
      entries.push({
        id: tagId(input.host, 'incident', `${monitor.id}/${start}`, start * 1000),
        title: `${monitor.name} incident`,
        content: incident.error.join('\n'),
        when: start * 1000,
        updated: (end ?? input.state.lastUpdate) * 1000,
        link: `${input.origin}/monitors/${encodeURIComponent(monitor.id)}`,
      });
    }
  }
  return entries;
}

function maintenanceEntries(input: FeedInput): FeedEntry[] {
  return input.maintenances.map((maintenance) => {
    const when = new Date(maintenance.start).getTime();
    return {
      id: tagId(input.host, 'maintenance', maintenance.id, maintenance.createdAt),
      title: maintenance.title ?? 'Scheduled maintenance',
      content: maintenance.body,
      when,
      updated: maintenance.updatedAt,
      link: `${input.origin}/history`,
    };
  });
}

function announcementEntries(input: FeedInput): FeedEntry[] {
  return input.announcements.map((announcement) => ({
    id: tagId(input.host, 'announcement', announcement.id, announcement.createdAt),
    title: announcement.title,
    content: announcement.body,
    when: announcement.createdAt,
    updated: announcement.updatedAt,
    link: `${input.origin}/`,
  }));
}

function atomFeed(input: FeedInput, updatedSeconds: number): string {
  const entries = [
    ...incidentEntries(input),
    ...maintenanceEntries(input),
    ...announcementEntries(input),
  ]
    .sort((a, b) => b.when - a.when)
    .slice(0, MAX_ENTRIES);

  const entryXml = entries
    .map(
      (entry) => `  <entry>
    <id>${escapeXml(entry.id)}</id>
    <title>${escapeXml(entry.title)}</title>
    <link href="${escapeXml(entry.link)}"/>
    <published>${iso(entry.when)}</published>
    <updated>${iso(entry.updated)}</updated>
    <content type="text">${escapeXml(entry.content)}</content>
  </entry>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${escapeXml(tagId(input.host, 'feed', 'status', 0))}</id>
  <title>${escapeXml(input.title)}</title>
  <author><name>${escapeXml(input.title)}</name></author>
  <link href="${escapeXml(input.origin)}/"/>
  <link href="${escapeXml(input.origin)}/feed.atom" rel="self" type="application/atom+xml"/>
  <updated>${iso(updatedSeconds * 1000)}</updated>
  ${entryXml}
</feed>`;
}

export const Route = createFileRoute('/feed.atom')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        try {
          const { origin, hostname: host } = new URL(request.url);
          const { monitors, state, maintenances, announcements } = await readVisitorSnapshot();
          return new Response(
            atomFeed(
              {
                monitors,
                state,
                maintenances,
                announcements,
                origin,
                host,
                title: getConfig().statusPage?.title ?? 'Status',
              },
              state?.lastUpdate ?? 0,
            ),
            { headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' } },
          );
        } catch (error) {
          console.error('Error rendering Atom feed:', error);
          return new Response('Internal server error', {
            status: 500,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      },
    },
  },
});
