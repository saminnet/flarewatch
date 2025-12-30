import { Card } from '@/components/ui/card';

export function PageSkeleton() {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="animate-pulse space-y-6">
        <div className="h-7 w-56 rounded bg-neutral-200 dark:bg-neutral-800" />

        <Card className="p-6">
          <div className="space-y-3">
            <div className="h-4 w-40 rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-9 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
          </div>
        </Card>

        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-4 w-52 rounded bg-neutral-200 dark:bg-neutral-800" />
                  <div className="h-3 w-72 max-w-full rounded bg-neutral-200 dark:bg-neutral-800" />
                </div>
                <div className="h-7 w-20 rounded bg-neutral-200 dark:bg-neutral-800" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
