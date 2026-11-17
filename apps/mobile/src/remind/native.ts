// The reminders on the phone itself (Android local notifications). Tapping one opens 讲给我听 on that debt; its two
// buttons are 改天再聊 and 这个不用了. Off the phone (browser, tests) nothing is scheduled.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { tr } from '../i18n';
import type { Reminder } from './plan';

const ACTIONS = 'debt';
export type Tapped = { entryId: string; action: 'open' | 'later' | 'drop' };

/** Replaces every reminder this app set with `rs`. Asks for permission once; a refusal just means no reminders. */
export async function schedule(rs: Reminder[]): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    if ((await LocalNotifications.checkPermissions()).display !== 'granted' &&
        (await LocalNotifications.requestPermissions()).display !== 'granted') return false;
    await LocalNotifications.registerActionTypes({ types: [{ id: ACTIONS, actions: [
      { id: 'later', title: tr('改天再聊') }, { id: 'drop', title: tr('这个不用了') }] }] });
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    if (rs.length) await LocalNotifications.schedule({ notifications: rs.map((r) => ({
      id: r.id, title: tr(r.title), body: r.body, schedule: { at: new Date(r.at), allowWhileIdle: true },
      actionTypeId: ACTIONS, extra: { entryId: r.entryId } })) });
    return true;
  } catch { return false; }
}

/** Calls `on` for every tap on a reminder or one of its buttons; returns the function that stops listening. */
export function onTap(on: (t: Tapped) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  const h = LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const entryId = String((a.notification.extra as { entryId?: string } | undefined)?.entryId ?? '');
    if (entryId) on({ entryId, action: a.actionId === 'later' ? 'later' : a.actionId === 'drop' ? 'drop' : 'open' });
  });
  return () => { void h.then((x) => x.remove()); };
}
