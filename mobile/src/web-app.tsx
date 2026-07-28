import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView, type WebViewNavigation } from 'react-native-webview'

import { WEB_APP_URL } from '@/src/lib/config'

const INJECT_NATIVE_CONTEXT = `
  (function () {
    document.documentElement.dataset.nativeApp = 'true';
    document.documentElement.classList.add('native-app-shell');
    window.__LSAT_SPEEDRUN_NATIVE__ = true;
  })();
  true;
`

export function WebApp() {
  const webView = useRef<WebView>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (Platform.OS !== 'android') return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack) return false
      webView.current?.goBack()
      return true
    })
    return () => subscription.remove()
  }, [canGoBack])

  const handleNavigation = useCallback((state: WebViewNavigation) => {
    setCanGoBack(state.canGoBack)
  }, [])

  const allowNavigation = useCallback((request: WebViewNavigation) => {
    const url = request.url
    if (!url || url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) return true
    if (url.startsWith(WEB_APP_URL)) return true

    // Embedded Google identity frames and CDN resources must remain inside the
    // page. Only explicit top-level link clicks leave the native application.
    const isTopFrame = 'isTopFrame' in request ? Boolean(request.isTopFrame) : true
    if (!isTopFrame) return true
    if (request.navigationType !== 'click') return true

    void Linking.openURL(url)
    return false
  }, [])

  const reload = useCallback(() => {
    setFailed(false)
    setLoading(true)
    webView.current?.reload()
  }, [])

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <WebView
        ref={webView}
        source={{ uri: WEB_APP_URL }}
        style={styles.webView}
        containerStyle={styles.webViewContainer}
        originWhitelist={['http://*', 'https://*', 'about:*', 'data:*', 'blob:*']}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        cacheMode="LOAD_DEFAULT"
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsInlineMediaPlayback
        allowsFullscreenVideo
        mediaPlaybackRequiresUserAction={false}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        setSupportMultipleWindows={false}
        applicationNameForUserAgent="LSATSpeedrunMobile/1.0"
        injectedJavaScriptBeforeContentLoaded={INJECT_NATIVE_CONTEXT}
        onNavigationStateChange={handleNavigation}
        onShouldStartLoadWithRequest={allowNavigation}
        onLoadStart={() => { setLoading(true); setFailed(false) }}
        onLoadEnd={() => setLoading(false)}
        onError={() => { setLoading(false); setFailed(true) }}
        onHttpError={({ nativeEvent }) => {
          if (nativeEvent.statusCode >= 500) setFailed(true)
        }}
        androidLayerType="hardware"
        overScrollMode="never"
        mixedContentMode={__DEV__ ? 'always' : 'never'}
        webviewDebuggingEnabled={__DEV__}
      />

      {loading && !failed ? <View pointerEvents="none" style={styles.loading}><ActivityIndicator color="#f2c75b" size="large" /><Text style={styles.loadingLabel}>OPENING THE FIRM</Text></View> : null}
      {failed ? <View style={styles.error}><Text style={styles.errorKicker}>CONNECTION INTERRUPTED</Text><Text style={styles.errorTitle}>The firm could not open.</Text><Text style={styles.errorCopy}>Confirm that the web application is running and that this device can reach {WEB_APP_URL}.</Text><Pressable accessibilityRole="button" onPress={reload} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#101725' },
  webViewContainer: { flex: 1, backgroundColor: '#101725' },
  webView: { flex: 1, backgroundColor: '#101725' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 15, backgroundColor: '#101725' },
  loadingLabel: { color: '#f2c75b', fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }), fontSize: 10, fontWeight: '800', letterSpacing: 1.8 },
  error: { ...StyleSheet.absoluteFillObject, padding: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#101725' },
  errorKicker: { color: '#f2c75b', fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }), fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  errorTitle: { marginTop: 10, color: '#f6e7bf', fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }), fontSize: 28, textAlign: 'center' },
  errorCopy: { maxWidth: 360, marginTop: 10, color: '#b4c9ce', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  retry: { minWidth: 160, minHeight: 46, marginTop: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#171923', backgroundColor: '#f2c75b' },
  retryText: { color: '#171923', fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace' }), fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
})
