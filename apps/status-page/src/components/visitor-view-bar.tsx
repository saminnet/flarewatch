import { Link } from '@tanstack/react-router';
import { IconEye } from '@tabler/icons-react';
import { buttonVariants } from '@/components/ui/button-variants';

export function VisitorViewBar() {
  return (
    <div className="border-b border-border bg-muted">
      <div className="container mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2 text-sm">
        <p className="flex items-center gap-2 text-muted-foreground">
          <IconEye className="size-4 shrink-0" aria-hidden="true" />
          Visitor view: this is the page as visitors see it.
        </p>
        <Link
          to="."
          search={(prev) => ({ ...prev, view: undefined })}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Exit visitor view
        </Link>
      </div>
    </div>
  );
}
