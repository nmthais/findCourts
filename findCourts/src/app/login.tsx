import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { useAuth } from '@/context/AuthContext';
import { useAppTheme } from '@/theme/appTheme';
import AccountBackButton from '@/components/AccountBackButton';

function loginErrorMessage(error: unknown) {
  if (!(error instanceof FirebaseError)) return 'Unable to log in. Please try again.';
  switch (error.code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'The email or password is incorrect.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a while before trying again.';
    case 'auth/network-request-failed':
      return 'Check your internet connection and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    default:
      return 'Unable to log in. Please try again later.';
  }
}

export default function Login() {
  const { colors } = useAppTheme();
  const { user, loading, isConfigured, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordInput = useRef<ComponentRef<typeof TextInput>>(null);
  const requestPending = useRef(false);

  useEffect(() => {
    if (!loading && user) router.replace('/account');
  }, [loading, user]);

  async function handleSubmit() {
    if (requestPending.current || loading || !isConfigured || user) return;
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    requestPending.current = true;
    setSubmitting(true);
    setError(null);
    Keyboard.dismiss();
    try {
      await login(email, password);
      // Wait for the auth listener to update user before navigating.
    } catch (error) {
      setError(loginErrorMessage(error));
    } finally {
      requestPending.current = false;
      setSubmitting(false);
    }
  }

  const disabled = submitting || !isConfigured;
  const inputStyle = [styles.input, {
    color: colors.text, backgroundColor: colors.surface, borderColor: colors.border,
  }];

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <AccountBackButton disabled={submitting} />
      {loading || user ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.button} accessibilityLabel="Loading account" />
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.form}>
              <Text style={[styles.title, { color: colors.text }]}>Welcome back</Text>
              <Text style={[styles.subtitle, { color: colors.secondaryText }]}>Log in to your FindCourts account.</Text>
              <Text style={[styles.label, { color: colors.text }]}>Email</Text>
              <TextInput
                style={inputStyle}
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
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordInput.current?.focus()}
                editable={!disabled}
              />
              <Text style={[styles.label, { color: colors.text }]}>Password</Text>
              <TextInput
                ref={passwordInput}
                style={inputStyle}
                accessibilityLabel="Password"
                value={password}
                onChangeText={(value) => { setPassword(value); setError(null); }}
                placeholder="Enter your password"
                placeholderTextColor={colors.secondaryText}
                selectionColor={colors.button}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
                editable={!disabled}
              />
              {(!isConfigured || error) && (
                <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, { color: colors.error }]}>
                  {!isConfigured ? 'Login is unavailable right now. Please try again later.' : error}
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
                <Text style={[styles.buttonText, { color: colors.buttonText }]}>{submitting ? 'Logging in…' : 'Log in'}</Text>
              </Pressable>
              <Pressable
                onPress={() => router.replace('/signup')}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityState={{ disabled: submitting }}
                style={({ pressed }) => [styles.secondaryButton, { backgroundColor: pressed ? colors.pressed : 'transparent' }]}
              >
                <Text style={{ color: colors.primary }}>New to FindCourts? Create an account</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
