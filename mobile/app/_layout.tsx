import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#101725" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#101725' } }}>
        <Stack.Screen name="index" />
      </Stack>
    </SafeAreaProvider>
  )
}
