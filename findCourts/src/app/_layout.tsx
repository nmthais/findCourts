import { CourtsProvider } from '@/context/CourtsContext';
import { AuthProvider } from '@/context/AuthContext';
import { Stack } from 'expo-router';
import AppToastProvider from '@/components/AppToastProvider';

export default function RootLayout() {
  return (
    <AppToastProvider>
      <AuthProvider>
        <CourtsProvider>
          <Stack>
            <Stack.Screen name="review" options={{ presentation: 'modal', headerShown: false }} />
          </Stack>
        </CourtsProvider>
      </AuthProvider>
    </AppToastProvider>
  );
}
