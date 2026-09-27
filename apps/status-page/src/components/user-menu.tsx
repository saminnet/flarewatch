import { useNavigate } from '@tanstack/react-router';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSignOut } from '@/lib/query/auth.mutations';
import type { Session } from '@/lib/session';

function initialsOf(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase() || '?'
  );
}

interface UserMenuProps {
  session: Session;
  visitorView: boolean;
}

export function UserMenu({ session, visitorView }: UserMenuProps) {
  const navigate = useNavigate();
  const signOut = useSignOut();
  const name = session.name ?? 'Operator';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu, signed in as ${name}`}
        className="ml-1 inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground outline-none transition-opacity hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {initialsOf(name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {session.canSignIn ? (
              <>
                Signed in as <span className="text-foreground">{name}</span>
              </>
            ) : (
              'Dev mode: sign-in is not set up'
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          closeOnClick
          checked={visitorView}
          onCheckedChange={(checked) =>
            void navigate({
              to: '.',
              search: (prev) => ({ ...prev, view: checked ? 'visitor' : undefined }),
            })
          }
        >
          Visitor view
        </DropdownMenuCheckboxItem>
        {session.canSignIn && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut.mutate()}>Sign out</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
