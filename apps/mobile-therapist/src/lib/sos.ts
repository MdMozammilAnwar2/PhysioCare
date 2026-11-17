import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { api } from './api';

// Sends SOS with the current location when available; sends it anyway if location fails.
export async function sendSos(visitId?: string) {
  let lat: number | undefined, lng: number | undefined;
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.granted) { const pos = await Location.getCurrentPositionAsync({}); lat = pos.coords.latitude; lng = pos.coords.longitude; }
  } catch { /* send without location rather than not at all */ }
  const r = await api.sos({ visitId, lat, lng });
  Alert.alert('SOS sent', r.message);
}
