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
import { ProfileError, validateUsername } from '@/services/profiles';

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function signupErrorMessage(error: unknown) {
  if (error instanceof ProfileError) return error.message;
  if (!(error instanceof FirebaseError)) return 'Unable to create your account. Please try again.';
  switch (error.code) {
    case 'auth/email-already-in-use':
      return 'An account already uses this email. Please log in instead.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'Choose a stronger password that meets the account password requirements.';
    case 'auth/operation-not-allowed':
      return 'Account creation is unavailable right now. Please try again later.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a while before trying again.';
    case 'auth/network-request-failed':
      return 'Check your internet connection and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    default:
      return 'Unable to create your account. Please try again later.';
  }
}

export default function Signup() {
  const { colors } = useAppTheme();
  const { user, loading, isConfigured, signup } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordInput = useRef<ComponentRef<typeof TextInput>>(null);
  const confirmInput = useRef<ComponentRef<typeof TextInput>>(null);
  const requestPending = useRef(false);
  const signupStarted = useRef(false);

  useEffect(() => {
    if (!loading && user && !signupStarted.current) router.replace('/account');
  }, [loading, user, submitting]);

  async function handleSubmit() {
    if (requestPending.current || loading || !isConfigured || user) return;
    if (!email.trim() || !password || !confirmPassword) {
      setError('Complete all fields.');
      return;
    }
    if (!validateUsername(username)) {
      setError('Use 3–24 letters, numbers, or underscores for your username.');
      return;
    }
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Use a password with at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Your passwords do not match.');
      return;
    }
    requestPending.current = true;
    signupStarted.current = true;
    setSubmitting(true);
    setError(null);
    Keyboard.dismiss();
    try {
      await signup(email, password, username);
      router.replace('/account');
    } catch (error) {
      setError(signupErrorMessage(error));
    } finally {
      requestPending.current = false;
      setSubmitting(false);
    }
  }

  const formComplete = validateUsername(username)
    && isValidEmail(email)
    && password.length >= 6
    && password === confirmPassword;
  const disabled = submitting || loading || !isConfigured || Boolean(user) || !formComplete;
  const inputStyle = [styles.input, {
    color: colors.text, backgroundColor: colors.surface, borderColor: colors.border,
  }];

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <AccountBackButton disabled={submitting} />
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.button} accessibilityLabel="Loading account" />
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.form}>
              <Text style={[styles.title, { color: colors.text }]}>Create an account</Text>
              <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
                Join FindCourts to share your court reviews.
              </Text>
              <Text style={[styles.label, { color: colors.text }]}>Username</Text>
              <TextInput
                style={inputStyle}
                accessibilityLabel="Username"
                value={username}
                onChangeText={(value) => { setUsername(value); setError(null); }}
                placeholder="e.g. court_fan"
                placeholderTextColor={colors.secondaryText}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                maxLength={24}
                editable={!disabled}
              />
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
                autoComplete="new-password"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => confirmInput.current?.focus()}
                editable={!disabled}
              />
              <Text style={[styles.label, { color: colors.text }]}>Confirm password</Text>
              <TextInput
                ref={confirmInput}
                style={inputStyle}
                accessibilityLabel="Confirm password"
                value={confirmPassword}
                onChangeText={(value) => { setConfirmPassword(value); setError(null); }}
                placeholder="Re-enter your password"
                placeholderTextColor={colors.secondaryText}
                selectionColor={colors.button}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
                editable={!disabled}
              />
              {(!isConfigured || error) && (
                <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, { color: colors.error }]}>
                  {!isConfigured ? 'Signup is unavailable right now. Please try again later.' : error}
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
                <Text style={[styles.buttonText, { color: colors.buttonText }]}>{submitting ? 'Creating account...' : 'Create account'}</Text>
              </Pressable>
              <Pressable
                onPress={() => router.replace('/login')}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityState={{ disabled: submitting }}
                style={({ pressed }) => [styles.secondaryButton, { backgroundColor: pressed ? colors.pressed : 'transparent' }]}
              >
                <Text style={{ color: colors.primary }}>Already have an account? Log in</Text>
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
