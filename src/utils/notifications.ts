export type PushPermissionState = NotificationPermission | 'unsupported';

export function getNotificationPermission(): PushPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<PushPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  try {
    const result = await Promise.race([
      Notification.requestPermission(),
      new Promise<NotificationPermission>((resolve) =>
        window.setTimeout(() => resolve(Notification.permission), 3000),
      ),
    ]);
    return result;
  } catch {
    return Notification.permission;
  }
}

export function sendBrowserNotification(title: string, body: string, tag?: string): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (Notification.permission !== 'granted') {
    return false;
  }
  try {
    const notification = new Notification(title, {
      body,
      tag: tag ?? `arcmatrix-${Date.now()}`,
      requireInteraction: false,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}
