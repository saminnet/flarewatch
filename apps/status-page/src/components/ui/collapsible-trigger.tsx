import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

export { CollapsibleTrigger };
