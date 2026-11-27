import { useEffect } from 'react';
import type { Session } from '@/lib/session';

export function useAccountSync(session: Session): void {
  const account = JSON.stringify([session.viewer, session.name, session.signedInAt]);

  useEffect(() => {
    const channel = new BroadcastChannel('flarewatch-account');
    channel.onmessage = ({ data }) => {
      if (data !== account) window.location.reload();
    };
    channel.postMessage(account);
    return () => channel.close();
  }, [account]);
}
