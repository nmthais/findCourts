import Attribution from '@/components/Attribution';
import { Stack } from 'expo-router';

export default function AttributionScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Attributions', headerShown: true }} />
      <Attribution />
    </>
  );
}
