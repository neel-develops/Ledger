import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { DashboardView } from '@shared/domain';

/**
 * Everything that only exists inside the Android shell.
 *
 * On the web every function here is a no-op, so nothing in the app has to ask
 * whether it is running natively before calling them.
 */

interface LedgerNativePlugin {
  updateWidget(options: Record<string, string | boolean>): Promise<{ updated: boolean }>;
  clearWidget(): Promise<void>;
}

const LedgerNative = registerPlugin<LedgerNativePlugin>('Ledger');

export const isNative = (): boolean => Capacitor.isNativePlatform();

/* ------------------------------------------------------------------ *
 * Widget
 * ------------------------------------------------------------------ */

/**
 * Hand the home-screen widget the figures the app just loaded.
 *
 * Amounts cross the bridge as strings of integer paise. A JavaScript number
 * would be a rounding hazard the moment it met a native `Double`, and the one
 * thing this app will not do is let a rupee change on its way to a screen.
 */
export async function syncWidget(dashboard: DashboardView, hidden: boolean): Promise<void> {
  if (!isNative()) return;
  try {
    await LedgerNative.updateWidget({
      ownedMoney: String(dashboard.ownedMoney),
      netPosition: String(dashboard.netPosition),
      owedToMe: String(dashboard.owedToMe),
      iOwe: String(dashboard.iOwe),
      cash: String(dashboard.byLocation.cash),
      digital: String(dashboard.byLocation.digital),
      hidden,
    });
  } catch (error) {
    // The widget is a convenience. It must never break the app.
    console.warn('[native] widget sync failed', error);
  }
}

/** On sign-out the widget must stop showing the previous person's money. */
export async function clearWidget(): Promise<void> {
  if (!isNative()) return;
  try {
    await LedgerNative.clearWidget();
  } catch (error) {
    console.warn('[native] widget clear failed', error);
  }
}

/* ------------------------------------------------------------------ *
 * Daily reminder
 * ------------------------------------------------------------------ */

const REMINDER_ID = 1001;

export interface ReminderSettings {
  enabled: boolean;
  /** 24-hour local time, e.g. "21:30". */
  time: string;
}

export async function canUseReminders(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const status = await LocalNotifications.checkPermissions();
    if (status.display === 'granted') return true;
    const asked = await LocalNotifications.requestPermissions();
    return asked.display === 'granted';
  } catch {
    return false;
  }
}

/**
 * Schedule (or cancel) the daily nudge.
 *
 * Deliberately gentle and specific: it asks whether anything went unrecorded,
 * because a reminder that just says "open the app" trains you to dismiss it.
 * Rescheduling always cancels first, so a changed time can never leave two
 * reminders running.
 */
export async function scheduleReminder(settings: ReminderSettings): Promise<boolean> {
  if (!isNative()) return false;

  try {
    await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
    if (!settings.enabled) return true;

    if (!(await canUseReminders())) return false;

    const [hourText, minuteText] = settings.time.split(':');
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;

    await LocalNotifications.schedule({
      notifications: [
        {
          id: REMINDER_ID,
          title: 'Anything to record?',
          body: 'Spent, lent or borrowed today? Takes about ten seconds.',
          schedule: { on: { hour, minute }, allowWhileIdle: true },
          smallIcon: 'ic_stat_ledger',
          extra: { route: '/' },
        },
      ],
    });
    return true;
  } catch (error) {
    console.warn('[native] could not schedule the reminder', error);
    return false;
  }
}

export async function cancelReminder(): Promise<void> {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
  } catch {
    /* nothing scheduled */
  }
}
