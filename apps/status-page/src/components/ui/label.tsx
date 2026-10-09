import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const labelVariants = cva(
  'gap-2 font-medium group-data-[disabled=true]:opacity-50 peer-disabled:opacity-50 flex items-center select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        default: 'text-sm leading-none',
        muted: 'text-xs text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Label({
  className,
  htmlFor,
  variant,
  ...props
}: React.ComponentProps<'label'> & VariantProps<typeof labelVariants>) {
  return (
    <label
      data-slot="label"
      htmlFor={htmlFor}
      className={cn(labelVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Label };
