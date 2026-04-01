import type { ExpoConfig } from 'expo/config';
import appJson from './app.json';
import rootPackageJson from '../../package.json';

const config = appJson.expo as unknown as ExpoConfig;
const version = rootPackageJson.version;

export default {
  ...config,
  version,
  extra: {
    ...(config.extra ?? {}),
    appVersion: version,
  },
} satisfies ExpoConfig;
