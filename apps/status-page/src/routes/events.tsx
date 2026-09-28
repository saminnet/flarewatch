import { createFileRoute, redirect } from '@tanstack/react-router';

// 1.x called the History page Events; this keeps its links working.
export const Route = createFileRoute('/events')({
  beforeLoad: ({ location }) => {
    throw redirect({ href: `/history${location.searchStr}` });
  },
});
