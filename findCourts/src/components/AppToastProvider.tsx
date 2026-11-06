import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import { ToastHost, ToastProvider } from 'react-native-toastify-expo';

export default function AppToastProvider({ children }: PropsWithChildren) {
  return (
    <ToastProvider position="top" theme="system" offset={{ top: 64 }}>
      {children}
      {/* Render above the native navigation layer on iOS. */}
      {Platform.OS === 'ios' && (
        <FullWindowOverlay>
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <ToastHost />
          </View>
        </FullWindowOverlay>
      )}
    </ToastProvider>
  );
}
