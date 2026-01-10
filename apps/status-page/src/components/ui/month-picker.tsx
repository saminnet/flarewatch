import { useState, useEffect } from 'react';
import { IconCalendar, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';

import { formatUtc, parseYearMonth } from '@/lib/date';
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
  const { year: selectedYear, month: selectedMonth } = parseYearMonth(value);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(selectedYear);

  // Reset viewYear when value changes externally
  useEffect(() => {
    setViewYear(parseYearMonth(value).year);
  }, [value]);

  const selectedMonthIndex = selectedMonth - 1; // 0-indexed for grid comparison

  const handleMonthClick = (monthIndex: number) => {
    const newValue = `${viewYear}-${(monthIndex + 1).toString().padStart(2, '0')}`;
    onChange(newValue);
    setOpen(false);
  };

  const displayDate = new Date(Date.UTC(selectedYear, selectedMonth - 1, 1));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className={cn('gap-1.5', className)}>
            <IconCalendar className="h-4 w-4 text-neutral-500" />
            <span className="text-sm font-medium">{formatUtc(displayDate, 'MMM yyyy')}</span>
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
            const isSelected = viewYear === selectedYear && i === selectedMonthIndex;
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
