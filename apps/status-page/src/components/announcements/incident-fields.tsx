import type { AnnouncementConfig, IncidentStatus } from '@flarewatch/shared';
import {
  INCIDENT_STATUSES,
  MAX_ANNOUNCEMENT_TEXT,
  MAX_ANNOUNCEMENT_UPDATES,
  isIncidentStatus,
} from '@flarewatch/shared';
import type { PublicMonitor } from '@/lib/public-view';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

export type IncidentFieldsValue = Pick<AnnouncementConfig, 'kind' | 'monitors'> & {
  status: IncidentStatus;
  updateBody?: string;
};

export function IncidentFields({
  value,
  onChange,
  monitors,
  editing,
  updateCount,
}: {
  value: IncidentFieldsValue;
  onChange: (value: IncidentFieldsValue) => void;
  monitors: PublicMonitor[];
  editing: boolean;
  updateCount: number;
}) {
  const incident = value.kind === 'incident';
  const selected = new Set(value.monitors);
  const choices = [
    ...monitors,
    ...[...selected]
      .filter((id) => !monitors.some((monitor) => monitor.id === id))
      .map((id) => ({ id, name: id })),
  ];
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="announcement-kind">Kind</Label>
        <Select
          disabled={editing}
          value={value.kind ?? 'notice'}
          onValueChange={(kind) =>
            onChange({ ...value, kind: kind === 'incident' ? 'incident' : 'notice' })
          }
        >
          <SelectTrigger id="announcement-kind">
            <SelectValue>{incident ? 'Incident' : 'Notice'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="notice">Notice</SelectItem>
            <SelectItem value="incident">Incident</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {incident && (
        <>
          <div>
            <Label htmlFor="incident-status">Status</Label>
            <Select
              disabled={editing && value.updateBody === undefined}
              value={value.status}
              onValueChange={(status) => {
                if (isIncidentStatus(status)) onChange({ ...value, status });
              }}
            >
              <SelectTrigger id="incident-status">
                <SelectValue>{value.status}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {INCIDENT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset>
            <legend>Affected monitors</legend>
            <p className="text-xs text-muted-foreground">None selected means the whole page.</p>
            <div className="flex flex-wrap gap-2">
              {choices.map((monitor) => (
                <Badge
                  key={monitor.id}
                  variant={selected.has(monitor.id) ? 'default' : 'outline'}
                  render={<button type="button" aria-pressed={selected.has(monitor.id)} />}
                  onClick={() =>
                    onChange({
                      ...value,
                      monitors: selected.has(monitor.id)
                        ? [...selected].filter((id) => id !== monitor.id)
                        : [...(value.monitors ?? []), monitor.id],
                    })
                  }
                >
                  {monitor.name}
                </Badge>
              ))}
            </div>
          </fieldset>
          {editing &&
            (value.updateBody === undefined ? (
              <Button
                variant="outline"
                disabled={updateCount >= MAX_ANNOUNCEMENT_UPDATES}
                onClick={() => onChange({ ...value, updateBody: '' })}
              >
                Add update
              </Button>
            ) : (
              <div>
                <Label htmlFor="incident-update">Update</Label>
                <Textarea
                  id="incident-update"
                  maxLength={MAX_ANNOUNCEMENT_TEXT}
                  value={value.updateBody}
                  onChange={(event) => onChange({ ...value, updateBody: event.target.value })}
                />
                <Button
                  variant="ghost"
                  onClick={() => onChange({ ...value, updateBody: undefined })}
                >
                  Cancel update
                </Button>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
