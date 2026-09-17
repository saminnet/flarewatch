import { useState } from 'react';
import { IconCalendar } from '@tabler/icons-react';

import { cn } from '@/lib/utils';
import { formatUtc } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface DateTimePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  clearLabel?: string;
  className?: string;
  disabled?: boolean;
}

const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
const minutes = Array.from({ length: 12 }, (_, i) => (i * 5).toString().padStart(2, '0'));

function formatHour(value: Date): string {
  return value.getUTCHours().toString().padStart(2, '0');
}

function formatMinute(value: Date): string {
  const roundedMinute = Math.round(value.getUTCMinutes() / 5) * 5;
  return (roundedMinute === 60 ? 0 : roundedMinute).toString().padStart(2, '0');
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  clearLabel,
  className,
  disabled,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [draftHour, setDraftHour] = useState('00');
  const [draftMinute, setDraftMinute] = useState('00');
  const hour = value ? formatHour(value) : draftHour;
  const minute = value ? formatMinute(value) : draftMinute;

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return onChange?.(undefined);
    const next = new Date(date.getTime());
    next.setUTCHours(parseInt(hour, 10), parseInt(minute, 10), 0, 0);
    onChange?.(next);
    setOpen(false);
  };

  const handleHourChange = (newHour: string | null) => {
    if (!newHour) return;
    setDraftHour(newHour);
    if (value) {
      const newDate = new Date(value);
      newDate.setUTCHours(parseInt(newHour, 10), parseInt(minute, 10), 0, 0);
      onChange?.(newDate);
    }
  };

  const handleMinuteChange = (newMinute: string | null) => {
    if (!newMinute) return;
    setDraftMinute(newMinute);
    if (value) {
      const newDate = new Date(value);
      newDate.setUTCHours(parseInt(hour, 10), parseInt(newMinute, 10), 0, 0);
      onChange?.(newDate);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            disabled={disabled}
            className={cn(
              'w-full justify-start text-left font-normal',
              !value && 'text-muted-foreground',
              className,
            )}
          >
            <IconCalendar className="mr-2 size-4" />
            {value ? formatUtc(value, "MMM d, yyyy HH:mm 'UTC'") : placeholder}
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          timeZone="UTC"
          selected={value}
          defaultMonth={value}
          onSelect={handleDateSelect}
        />
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Time (UTC):</span>
            <Select value={hour} onValueChange={handleHourChange}>
              <SelectTrigger className="w-16">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hours.map((h) => (
                  <SelectItem key={h} value={h}>
                    {h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">:</span>
            <Select value={minute} onValueChange={handleMinuteChange}>
              <SelectTrigger className="w-16">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {minutes.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {clearLabel && value && (
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraftHour('00');
                  setDraftMinute('00');
                  onChange?.(undefined);
                  setOpen(false);
                }}
              >
                {clearLabel}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
