// Sign-in storage: the phone's secure storage on Android/iOS; the browser's storage when the app runs on the web
// (web is for previews and testing only — phones always use SecureStore).
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const web = Platform.OS === 'web';
export const storage = {
  getItemAsync: async (k: string) => (web ? globalThis.localStorage?.getItem(k) ?? null : SecureStore.getItemAsync(k)),
  setItemAsync: async (k: string, v: string) => { if (web) globalThis.localStorage?.setItem(k, v); else await SecureStore.setItemAsync(k, v); },
  deleteItemAsync: async (k: string) => { if (web) globalThis.localStorage?.removeItem(k); else await SecureStore.deleteItemAsync(k); },
};
