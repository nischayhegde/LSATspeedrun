import { Platform } from 'react-native'

const fallbackWebApp = Platform.select({
  android: 'http://10.0.2.2:5173',
  default: 'http://127.0.0.1:5173',
})

/**
 * The Expo shell renders the same deployed React application as desktop.
 * A physical device must use an HTTPS production URL or the development
 * computer's LAN address; 127.0.0.1 always refers to the phone itself.
 */
export const WEB_APP_URL = (process.env.EXPO_PUBLIC_WEB_APP_URL || fallbackWebApp).replace(/\/$/, '')
