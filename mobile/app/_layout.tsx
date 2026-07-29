import { Stack } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#101725' } }}>
        <Stack.Screen name="index" />
      </Stack>
    </SafeAreaProvider>
  )
}
