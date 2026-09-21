import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet } from './ui/Sheet';
import { Button } from './ui/Button';
import { Field } from './ui/primitives';
import { usePrefs } from '../store/prefs';
import { isNative, scheduleReminder, cancelReminder, canUseReminders } from '../lib/native';

/**
 * The daily reminder.
 *
 * One notification, at a time you choose, asking whether anything went
 * unrecorded. Notifications are a privilege that is very easy to abuse, so
 * this is the only one the app ever sends — and it is off until you turn it on.
 */
export function ReminderSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { reminderEnabled, reminderTime, setReminder } = usePrefs();

  const [enabled, setEnabled] = useState(reminderEnabled);
  const [time, setTime] = useState(reminderTime);
  const [saving, setSaving] = useState(false);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  useEffect(() => {
    if (!open) return;
    setEnabled(reminderEnabled);
    setTime(reminderTime);
  }, [open, reminderEnabled, reminderTime]);

  const native = isNative();

  async function save() {
    setSaving(true);
    try {
      if (!enabled) {
        await cancelReminder();
        setReminder(false, time);
        toast.success('Reminder turned off');
        onClose();
        return;
      }

      const allowed = await canUseReminders();
      if (!allowed) {
        setPermission('denied');
        setSaving(false);
        return;
      }

      const ok = await scheduleReminder({ enabled: true, time });
      if (!ok) {
        setPermission('denied');
        setSaving(false);
        return;
      }

      setPermission('granted');
      setReminder(true, time);
      toast.success(`Reminder set for ${formatTime(time)}`, {
        description: 'Every day, until you turn it off.',
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Daily reminder">
      <div className="space-y-4 pb-2">
        <p className="text-[14px] leading-relaxed text-ink-muted">
          A single notification each day asking whether anything went unrecorded. It is the only
          notification this app sends.
        </p>

        {!native ? (
          <p className="rounded-md bg-surface-sunken px-3.5 py-3 text-[13.5px] leading-relaxed text-ink-soft">
            Reminders need the Android app. In a browser there is nothing reliable to schedule against, so
            rather than set something that might not fire, the app does not pretend to.
          </p>
        ) : (
          <>
            <label className="flex items-center justify-between rounded-md border border-line bg-surface px-3.5 py-3">
              <span className="text-[15px] font-medium">Remind me daily</span>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="size-5 accent-[#5856D6]"
              />
            </label>

            {enabled && (
              <Field label="At" hint="Pick a time you are usually free — evenings work best.">
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="h-12 w-full rounded-md border border-line-strong bg-surface px-3.5 text-[16px] focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent-soft"
                />
              </Field>
            )}

            {permission === 'denied' && (
              <p className="rounded-md bg-negative-soft px-3.5 py-3 text-[13.5px] leading-relaxed text-negative">
                Android has not granted notification permission, so nothing was scheduled. Allow
                notifications for Ledger in your phone’s settings and try again.
              </p>
            )}

            <Button block size="lg" onClick={save} loading={saving} icon={<BellRing className="size-[18px]" />}>
              {enabled ? `Remind me at ${formatTime(time)}` : 'Turn reminders off'}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}

function formatTime(value: string): string {
  const [h, m] = value.split(':').map(Number);
  if (h === undefined || m === undefined) return value;
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}
