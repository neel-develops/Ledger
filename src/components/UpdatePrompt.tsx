import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { ArrowUpCircle } from 'lucide-react';
import { Button } from './ui/Button';

/**
 * "A new version is ready."
 *
 * The service worker never reloads on its own: doing so mid-entry would throw
 * away an amount someone was halfway through typing. It waits, visibly, until
 * they choose.
 */
export function UpdatePrompt() {
  const [ready, setReady] = useState(false);
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        setUpdate(() => () => updateSW(true));
        setReady(true);
      },
    });
  }, []);

  if (!ready) return null;

  return (
    <div className="animate-rise fixed inset-x-0 bottom-[calc(150px+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-[560px] justify-center px-4">
      <div className="glass-strong flex items-center gap-3 rounded-[18px] px-3.5 py-2.5 shadow-raised">
        <ArrowUpCircle className="size-[18px] shrink-0 text-accent" aria-hidden />
        <span className="text-[14px] font-medium text-ink">A new version is ready</span>
        <Button
          size="sm"
          className="h-9 px-3.5"
          onClick={() => {
            void update?.();
          }}
        >
          Reload
        </Button>
      </div>
    </div>
  );
}
