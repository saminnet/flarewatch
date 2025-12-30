import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { IconCalendar, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface MonthPickerProps {
  value: string; // "yyyy-MM" format
  onChange: (value: string) => void;
  className?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function MonthPicker({ value, onChange, className }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => {
    const [year] = value.split('-');
    return parseInt(year ?? new Date().getFullYear().toString(), 10);
  });

  // Reset viewYear when value changes externally
  useEffect(() => {
    const [year] = value.split('-');
    setViewYear(parseInt(year ?? new Date().getFullYear().toString(), 10));
  }, [value]);

  const selectedYear = parseInt(value.split('-')[0] ?? '0', 10);
  const selectedMonth = parseInt(value.split('-')[1] ?? '0', 10) - 1; // 0-indexed

  const handleMonthClick = (monthIndex: number) => {
    const newValue = `${viewYear}-${(monthIndex + 1).toString().padStart(2, '0')}`;
    onChange(newValue);
    setOpen(false);
  };

  const displayDate = new Date(`${value}-01`);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className={cn('gap-1.5', className)}>
            <IconCalendar className="h-4 w-4 text-neutral-500" />
            <span className="text-sm font-medium">{format(displayDate, 'MMM yyyy')}</span>
          </Button>
        }
      />
      <PopoverContent className="w-44 p-2" align="center">
        <div className="mb-2 flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewYear((y) => y - 1)}
            aria-label="Previous year"
          >
            <IconChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-sm font-medium">{viewYear}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewYear((y) => y + 1)}
            aria-label="Next year"
          >
            <IconChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-0.5">
          {MONTHS.map((month, i) => {
            const isSelected = viewYear === selectedYear && i === selectedMonth;
            return (
              <Button
                key={month}
                variant={isSelected ? 'default' : 'ghost'}
                size="sm"
                onClick={() => handleMonthClick(i)}
                className="h-7 px-2 text-xs"
              >
                {month}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
