import type { ExpoConfig } from 'expo/config';
import appJson from './app.json';
import rootPackageJson from '../../package.json';

const config = appJson.expo as unknown as ExpoConfig;
const version = rootPackageJson.version;

const expoConfig: ExpoConfig = {
  ...config,
  version,
  extra: {
    ...(config.extra ?? {}),
    appVersion: version,
  },
};

export default expoConfig;
