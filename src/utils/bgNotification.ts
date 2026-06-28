import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// ── Inference notification ────────────────────────────────────────────────────
const CHANNEL_ID = 'peek-inference';
const RUNNING_ID = 'peek-running';
const DONE_ID = 'peek-done';
const STOP_ACTION_ID = 'stop-inference';
const CATEGORY_ID = 'inference-running';

let channelReady = false;
let categoryReady = false;
let _cancelFn: (() => void) | null = null;
let _responseListener: Notifications.Subscription | null = null;

// ── Download notification ─────────────────────────────────────────────────────
const DL_CHANNEL_ID = 'peek-downloads';
const DL_NOTIF_ID = 'peek-dl-progress';
const DL_CANCEL_ACTION = 'cancel-download';
const DL_CATEGORY_ID = 'download-active';

let dlChannelReady = false;
let dlCategoryReady = false;
let _dlCancelFn: (() => Promise<void>) | null = null;
let _dlResponseListener: Notifications.Subscription | null = null;
let _dlLastNotifMs = 0;

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  return `${Math.round(b / 1e6)} MB`;
}
function fmtSpeed(bps: number): string {
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`;
  if (bps >= 1e3) return `${Math.round(bps / 1e3)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

async function ensureDlChannel() {
  if (dlChannelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(DL_CHANNEL_ID, {
    name: 'Downloads',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
    vibrationPattern: null,
    enableVibrate: false,
  });
  dlChannelReady = true;
}

async function ensureDlCategory() {
  if (dlCategoryReady) return;
  try {
    await Notifications.setNotificationCategoryAsync(DL_CATEGORY_ID, [
      {
        identifier: DL_CANCEL_ACTION,
        buttonTitle: 'Cancel',
        options: { isDestructive: true, opensAppToForeground: false },
      },
    ]);
    dlCategoryReady = true;
    if (!_dlResponseListener) {
      _dlResponseListener = Notifications.addNotificationResponseReceivedListener(response => {
        if (response.actionIdentifier === DL_CANCEL_ACTION) {
          _dlCancelFn?.();
        }
      });
    }
  } catch {}
}

export function registerDownloadCancel(fn: () => Promise<void>) { _dlCancelFn = fn; }
export function unregisterDownloadCancel() { _dlCancelFn = null; }

export async function showDownloadProgressNotification(
  modelName: string,
  phase: string,
  pct: number,
  bytesWritten: number,
  bytesTotal: number,
  speedBps: number,
  force = false,
) {
  const now = Date.now();
  if (!force && now - _dlLastNotifMs < 1200) return; // throttle to ~1/sec
  _dlLastNotifMs = now;
  try {
    await ensureDlChannel();
    await ensureDlCategory();
    const byteStr = bytesTotal > 0 ? `${fmtBytes(bytesWritten)} / ${fmtBytes(bytesTotal)}` : '';
    const speedStr = speedBps > 0 ? `  ${fmtSpeed(speedBps)}` : '';
    const body = [byteStr, speedStr].filter(Boolean).join(' ·') || `Starting…`;
    await Notifications.scheduleNotificationAsync({
      identifier: DL_NOTIF_ID,
      content: {
        title: `Downloading ${modelName}  ${pct}%`,
        body,
        sound: false,
        sticky: true,
        categoryIdentifier: DL_CATEGORY_ID,
        ...(Platform.OS === 'android' ? { android: { channelId: DL_CHANNEL_ID } } : {}),
      },
      trigger: null,
    });
  } catch {}
}

export async function showDownloadDoneNotification(modelName: string) {
  try {
    await ensureDlChannel();
    await Notifications.dismissNotificationAsync(DL_NOTIF_ID);
    await Notifications.scheduleNotificationAsync({
      identifier: DL_NOTIF_ID,
      content: {
        title: 'Download complete',
        body: `${modelName} is ready to use.`,
        sound: false,
        ...(Platform.OS === 'android' ? { android: { channelId: DL_CHANNEL_ID } } : {}),
      },
      trigger: null,
    });
  } catch {}
}

export async function clearDownloadNotification() {
  _dlLastNotifMs = 0;
  try { await Notifications.dismissNotificationAsync(DL_NOTIF_ID); } catch {}
}

export function registerInferenceCancel(fn: () => void) {
  _cancelFn = fn;
}

export function unregisterInferenceCancel() {
  _cancelFn = null;
}

async function ensureChannel() {
  if (channelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'AI Tasks',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
    vibrationPattern: null,
    enableVibrate: false,
  });
  channelReady = true;
}

async function ensureCategory() {
  if (categoryReady) return;
  try {
    await Notifications.setNotificationCategoryAsync(CATEGORY_ID, [
      {
        identifier: STOP_ACTION_ID,
        buttonTitle: 'Stop',
        options: { isDestructive: true, opensAppToForeground: false },
      },
    ]);
    categoryReady = true;
    if (!_responseListener) {
      _responseListener = Notifications.addNotificationResponseReceivedListener(response => {
        if (response.actionIdentifier === STOP_ACTION_ID) {
          _cancelFn?.();
          void clearInferenceNotifications();
        }
      });
    }
  } catch {}
}

export async function requestNotificationPermission() {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function showRunningNotification(label = 'Peek') {
  try {
    await ensureChannel();
    await ensureCategory();
    await Notifications.dismissNotificationAsync(RUNNING_ID);
    await Notifications.scheduleNotificationAsync({
      identifier: RUNNING_ID,
      content: {
        title: `${label} is working`,
        body: 'Tap Stop to cancel.',
        sound: false,
        sticky: true,
        categoryIdentifier: CATEGORY_ID,
        ...(Platform.OS === 'android' ? { android: { channelId: CHANNEL_ID } } : {}),
      },
      trigger: null,
    });
  } catch {}
}

export async function showDoneNotification(label = 'Peek') {
  try {
    await ensureChannel();
    await Notifications.dismissNotificationAsync(RUNNING_ID);
    await Notifications.scheduleNotificationAsync({
      identifier: DONE_ID,
      content: {
        title: `${label} finished`,
        body: 'Your result is ready.',
        sound: false,
        ...(Platform.OS === 'android' ? { android: { channelId: CHANNEL_ID } } : {}),
      },
      trigger: null,
    });
  } catch {}
}

export async function clearInferenceNotifications() {
  try {
    await Notifications.dismissNotificationAsync(RUNNING_ID);
    await Notifications.dismissNotificationAsync(DONE_ID);
  } catch {}
}
