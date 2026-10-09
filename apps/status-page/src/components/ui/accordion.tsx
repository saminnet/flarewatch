import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion';

import { cn } from '@/lib/utils';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';

function Accordion({
  className,
  variant = 'default',
  ...props
}: AccordionPrimitive.Root.Props & { variant?: 'default' | 'card' }) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      data-variant={variant}
      className={cn(
        'group/accordion flex w-full flex-col data-[variant=card]:space-y-2',
        className,
      )}
      {...props}
    />
  );
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn(
        'not-last:border-b group-data-[variant=card]/accordion:rounded-[calc(var(--radius-lg)+(--spacing(3)))] group-data-[variant=card]/accordion:border',
        className,
      )}
      {...props}
    />
  );
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          'focus-visible:ring-ring/50 focus-visible:border-ring focus-visible:after:border-ring **:data-[slot=accordion-trigger-icon]:text-muted-foreground rounded-md py-4 text-left text-sm font-medium hover:underline focus-visible:ring-[3px] **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 group/accordion-trigger relative flex flex-1 items-start justify-between border border-transparent transition-all outline-none disabled:pointer-events-none disabled:opacity-50 group-data-[variant=card]/accordion:rounded-[calc(var(--radius-lg)+(--spacing(3)))] group-data-[variant=card]/accordion:px-3 group-data-[variant=card]/accordion:py-2.5 group-data-[variant=card]/accordion:hover:no-underline group-data-[variant=card]/accordion:hover:bg-muted/50',
          className,
        )}
        {...props}
      >
        {children}
        <IconChevronDown
          data-slot="accordion-trigger-icon"
          className="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden"
        />
        <IconChevronUp
          data-slot="accordion-trigger-icon"
          className="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="text-sm overflow-hidden"
      {...props}
    >
      <div
        className={cn(
          'pt-0 pb-4 [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3 group-data-[variant=card]/accordion:px-3 group-data-[variant=card]/accordion:pt-1.5 group-data-[variant=card]/accordion:pb-3',
          className,
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Panel>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
