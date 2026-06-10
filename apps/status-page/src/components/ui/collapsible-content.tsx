import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';

function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />;
}

export { CollapsibleContent };
