import { Card } from '@/components/ui/card';
import { PAGE_CONTAINER_CLASSES } from '@/lib/constants';

export function PageSkeleton() {
  return (
    <div className={PAGE_CONTAINER_CLASSES}>
      <div className="animate-pulse space-y-3">
        <div className="h-7 w-56 rounded bg-muted" />

        <Card className="p-6">
          <div className="space-y-3">
            <div className="h-4 w-40 rounded bg-muted" />
            <div className="h-9 w-full rounded bg-muted" />
          </div>
        </Card>

        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-52 rounded bg-muted" />
                  <div className="h-3 w-72 max-w-full rounded bg-muted" />
                </div>
                <div className="h-7 w-20 rounded bg-muted" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
