import type { ExpoConfig, ConfigContext } from 'expo/config';
import base from './app.json';
export default function config(_:ConfigContext):ExpoConfig {
  const environment=process.env.EXPO_PUBLIC_APP_ENV ?? 'local';
  if (!['local','preview','production'].includes(environment)) throw new Error('Unknown app environment');
  return {...base.expo,extra:{...base.expo.extra,environment}} as ExpoConfig;
}
