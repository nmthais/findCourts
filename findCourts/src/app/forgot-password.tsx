import { useRef, useState } from 'react';
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import AccountBackButton from '@/components/AccountBackButton';
import { useAuth } from '@/context/AuthContext';
import { useAppTheme } from '@/theme/appTheme';

function resetErrorMessage(error: unknown) {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a while before trying again.';
      case 'auth/network-request-failed':
        return 'Check your internet connection and try again.';
    }
  }
  return 'Unable to send a reset link. Please try again later.';
}

export default function ForgotPassword() {
  const { colors } = useAppTheme();
  const { isConfigured, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestPending = useRef(false);
  const disabled = submitting || !isConfigured;

  async function handleSubmit() {
    if (requestPending.current || !isConfigured || sentEmail) return;
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Please enter a valid email address.');
      return;
    }
    requestPending.current = true;
    setSubmitting(true);
    setError(null);
    Keyboard.dismiss();
    try {
      await resetPassword(address);
      setSentEmail(address);
    } catch (error) {
      // Keep the same confirmation for unknown accounts to protect account privacy.
      if (error instanceof FirebaseError && error.code === 'auth/user-not-found') {
        setSentEmail(address);
      } else {
        setError(resetErrorMessage(error));
      }
    } finally {
      requestPending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <AccountBackButton disabled={submitting} />
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
              {sentEmail ? 'Check your email' : 'Forgot password?'}
            </Text>
            {sentEmail ? (
              <View accessibilityLiveRegion="polite">
                <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
                  If an account exists for {sentEmail}, you will receive an email with a link to reset your password.
                </Text>
                <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
                  Open the link to choose a new password, then return here to log in. If you do not see the email, check your spam folder.
                </Text>
              </View>
            ) : (
              <>
                <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
                  Enter your account email and we will send you a password reset link.
                </Text>
                <Text style={[styles.label, { color: colors.text }]}>Email</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
                  accessibilityLabel="Email"
                  value={email}
                  onChangeText={(value) => { setEmail(value); setError(null); }}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.secondaryText}
                  selectionColor={colors.button}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  returnKeyType="send"
                  onSubmitEditing={handleSubmit}
                  editable={!disabled}
                />
                {(!isConfigured || error) && (
                  <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, { color: colors.error }]}>
                    {!isConfigured ? 'Password reset is unavailable right now. Please try again later.' : error}
                  </Text>
                )}
                <Pressable
                  onPress={handleSubmit}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityState={{ disabled, busy: submitting }}
                  style={({ pressed }) => [styles.button, { backgroundColor: colors.button, opacity: disabled ? 0.6 : pressed ? 0.8 : 1 }]}
                >
                  {submitting && <ActivityIndicator color={colors.buttonText} />}
                  <Text style={[styles.buttonText, { color: colors.buttonText }]}>
                    {submitting ? 'Sending link...' : 'Send reset link'}
                  </Text>
                </Pressable>
              </>
            )}
            <Pressable
              onPress={() => router.replace('/login')}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting }}
              style={({ pressed }) => [styles.secondaryButton, { backgroundColor: pressed ? colors.pressed : 'transparent' }]}
            >
              <Text style={{ color: colors.primary }}>Back to log in</Text>
            </Pressable>
            {sentEmail && (
              <Pressable
                onPress={() => { setSentEmail(null); setError(null); }}
                accessibilityRole="button"
                style={({ pressed }) => [styles.secondaryButton, { backgroundColor: pressed ? colors.pressed : 'transparent' }]}
              >
                <Text style={{ color: colors.primary }}>Try again or use another email</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  form: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 28,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    minHeight: 50,
    marginBottom: 20,
  },
  error: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  button: {
    minHeight: 50,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    minHeight: 48,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
