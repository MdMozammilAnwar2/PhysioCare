// Push notifications (Expo). Registers this phone after sign-in so bookings, reminders and safety alerts arrive.
// Real push needs a development or store build (`eas build`) with an EAS project id; Expo Go and simulators skip quietly.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from './api';

const APP = 'therapist' as const;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

/** Asks once, then sends the Expo push token to the API. Returns why it didn't register, if it didn't. */
export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return 'not a real device';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Bookings and updates', importance: Notifications.AndroidImportance.DEFAULT, lightColor: '#5146D9' });
    await Notifications.setNotificationChannelAsync('urgent', { name: 'Visit day and safety', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250], lightColor: '#5146D9' });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return 'permission denied';
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return 'no EAS project id (run `eas init`)';
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerDevice({ pushToken: data, platform: Platform.OS === 'ios' ? 'ios' : 'android', app: APP, appVersion: Constants.expoConfig?.version });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'push registration failed';
  }
}
