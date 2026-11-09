import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '@/theme/appTheme';
import AccountBackButton from '@/components/AccountBackButton';
import { useAuth } from '@/context/AuthContext';
import { useEffect, useRef, useState } from 'react';
import { router, Stack } from 'expo-router';
import { toast } from 'react-native-toastify-expo';
import { getProfile, saveProfile, validateUsername, ProfileError, type Profile } from '@/services/profiles';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FirebaseError } from 'firebase/app';

function passwordErrorMessage(error: unknown) {
    if (!(error instanceof FirebaseError)) return 'Unable to change your password. Please try again.';
    switch (error.code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
            return 'Your current password is incorrect.';
        case 'auth/weak-password':
        case 'auth/password-does-not-meet-requirements':
            return 'Choose a stronger password that meets the account password requirements.';
        case 'auth/too-many-requests':
            return 'Too many attempts. Please wait before trying again.';
        case 'auth/network-request-failed':
            return 'Check your internet connection and try again.';
        default:
            return 'Unable to change your password. Please try again.';
    }
}

export default function Account() {
    const { user, loading, isConfigured, logout, changePassword } = useAuth();
    const { colors } = useAppTheme();
    const [signingOut, setSigningOut] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const signOutPending = useRef(false);
    const [profileState, setProfileState] = useState<{ uid: string; profile: Profile | null; error: string | null } | null>(null);
    const [profileRetry, setProfileRetry] = useState(0);
    const [username, setUsername] = useState('');
    const [savingUsername, setSavingUsername] = useState(false);
    const [usernameError, setUsernameError] = useState<string | null>(null);
    const [editingUsername, setEditingUsername] = useState(false);
    const [editingPassword, setEditingPassword] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [savingPassword, setSavingPassword] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const passwordPending = useRef(false);
    const savePending = useRef(false);
    const currentProfile = profileState?.uid === user?.uid ? profileState : null;

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        getProfile(user).then(
            (profile) => {
                if (!cancelled) setProfileState({ uid: user.uid, profile, error: null });
            },
            () => {
                if (!cancelled) setProfileState({ uid: user.uid, profile: null, error: 'Unable to load your username.' });
            },
        );
        return () => { cancelled = true; };
    }, [user, profileRetry]);

    useEffect(() => {
        // Intentional sign-out returns to the map without the login warning.
        if (loading || signOutPending.current) return;

        if (!isConfigured) {
            toast.error('Account settings are unavailable right now. Please try again later.', {
                id: 'account-unavailable',
            });
            router.replace('/');
        } else if (!user) {
            toast.warning('Please log in to access your account.', {
                id: 'account-login-required',
            });
            router.replace('/login');
        }
    }, [loading, isConfigured, user]);

    async function handleSaveUsername() {
        if (!user || savePending.current || signOutPending.current) return;
        if (!validateUsername(username)) {
            setUsernameError('Use 3-24 letters, numbers, or underscores for your username.');
            return;
        }
        savePending.current = true;
        setSavingUsername(true);
        setUsernameError(null);
        try {
            const profile = await saveProfile(user, username);
            setProfileState({ uid: user.uid, profile, error: null });
            setEditingUsername(false);
            setUsername('');
            toast.success('Username updated.', { id: 'username-updated' });
        } catch (error) {
            setUsernameError(error instanceof ProfileError ? error.message : 'Unable to save your username. Please try again.');
        } finally {
            savePending.current = false;
            setSavingUsername(false);
        }
    }

    function cancelUsernameEdit() {
        setEditingUsername(false);
        setUsername('');
        setUsernameError(null);
    }

    async function handleChangePassword() {
        if (passwordPending.current || signOutPending.current || savePending.current) return;
        if (!currentPassword || !newPassword || !confirmPassword) {
            setPasswordError('Complete all password fields.');
            return;
        }
        if (newPassword.length < 6) {
            setPasswordError('Use a new password with at least 6 characters.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordError('Your new passwords do not match.');
            return;
        }
        passwordPending.current = true;
        setSavingPassword(true);
        setPasswordError(null);
        try {
            await changePassword(currentPassword, newPassword);
            setEditingPassword(false);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            toast.success('Password updated.', { id: 'password-updated' });
        } catch (error) {
            setPasswordError(passwordErrorMessage(error));
        } finally {
            passwordPending.current = false;
            setSavingPassword(false);
        }
    }

    function cancelPasswordEdit() {
        setEditingPassword(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordError(null);
    }

    async function handleSignOut() {
        if (signOutPending.current || savePending.current || passwordPending.current) return;
        signOutPending.current = true;
        setSigningOut(true);
        setError(null);
        try {
            await logout();
            router.replace('/');
        } catch {
            signOutPending.current = false;
            setSigningOut(false);
            setError('Unable to sign out. Please try again.');
        }
    }

    const createdAt = user?.metadata.creationTime;
    const joinedDate = createdAt ? new Date(createdAt) : null;
    const memberSince = joinedDate && !Number.isNaN(joinedDate.getTime())
        ? joinedDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
        : 'Unavailable';

    return (
        <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
            <Stack.Screen options={{ headerShown: false }} />
            <AccountBackButton disabled={signingOut || savingUsername || savingPassword} />
            {loading || !isConfigured || !user ? (
                <View style={styles.loading}>
                    <ActivityIndicator color={colors.button} accessibilityLabel={signingOut ? 'Signing out' : 'Loading account'} />
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
                    <View style={styles.container}>
                        <Text style={[styles.title, { color: colors.text }]}>Account settings</Text>
                        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>Your FindCourts account details.</Text>
                        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                            <Text style={[styles.label, { color: colors.secondaryText }]}>Username</Text>
                            <View style={styles.settingRow}>
                                <Text style={[styles.value, styles.settingValue, { color: colors.text }]}>
                                    {!currentProfile ? 'Loading...' : currentProfile.error || currentProfile.profile?.username || 'Not set'}
                                </Text>
                                {currentProfile?.profile && !editingUsername && (
                                    <Pressable
                                        accessibilityLabel="Edit username"
                                        accessibilityRole="button"
                                        hitSlop={10}
                                        onPress={() => {
                                            setUsername(currentProfile.profile?.username ?? '');
                                            setEditingUsername(true);
                                        }}
                                        style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? colors.pressed : 'transparent' }]}
                                    >
                                        <Ionicons name="pencil-outline" size={20} color={colors.icons} />
                                    </Pressable>
                                )}
                            </View>
                            {currentProfile?.error ? (
                                <Pressable accessibilityRole="button" disabled={signingOut} onPress={() => {
                                    setProfileState(null);
                                    setProfileRetry((value) => value + 1);
                                }} style={{ paddingVertical: 12 }}>
                                    <Text style={{ color: colors.primary }}>Retry loading username</Text>
                                </Pressable>
                            ) : currentProfile && (!currentProfile.profile || editingUsername) ? (
                                <View style={styles.completeProfile}>
                                    {!currentProfile.profile && <Text style={{ color: colors.secondaryText }}>Finish your profile by choosing a username.</Text>}
                                    <TextInput
                                        accessibilityLabel="Username"
                                        value={username}
                                        onChangeText={(value) => { setUsername(value); setUsernameError(null); }}
                                        placeholder="e.g. court_fan"
                                        placeholderTextColor={colors.secondaryText}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        autoComplete="username"
                                        maxLength={24}
                                        editable={!savingUsername && !signingOut}
                                        returnKeyType="done"
                                        onSubmitEditing={handleSaveUsername}
                                        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                                    />
                                    {usernameError && <Text accessibilityRole="alert" style={{ color: colors.error }}>{usernameError}</Text>}
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityState={{ disabled: savingUsername || signingOut, busy: savingUsername }}
                                        disabled={savingUsername || signingOut}
                                        onPress={handleSaveUsername}
                                        style={({ pressed }) => [styles.button, { backgroundColor: colors.button, opacity: pressed || savingUsername ? 0.6 : 1 }]}
                                    >
                                        {savingUsername && <ActivityIndicator color={colors.buttonText} />}
                                        <Text style={[styles.buttonText, { color: colors.buttonText }]}>{savingUsername ? 'Saving...' : 'Save username'}</Text>
                                    </Pressable>
                                    {editingUsername && (
                                        <Pressable accessibilityRole="button" disabled={savingUsername} onPress={cancelUsernameEdit} style={styles.cancelButton}>
                                            <Text style={{ color: colors.secondaryText }}>Cancel</Text>
                                        </Pressable>
                                    )}
                                </View>
                            ) : null}
                            <Text style={[styles.label, { color: colors.secondaryText }]}>Email</Text>
                            <Text selectable style={[styles.value, { color: colors.text }]}>{user.email || 'Not provided'}</Text>
                            <Text style={[styles.label, { color: colors.secondaryText }]}>Member since</Text>
                            <Text style={[styles.value, { color: colors.text }]}>{memberSince}</Text>
                            <Text style={[styles.label, { color: colors.secondaryText }]}>Password</Text>
                            <View style={styles.settingRow}>
                                <Text style={[styles.value, styles.settingValue, { color: colors.text }]}>••••••••</Text>
                                {!editingPassword && (
                                    <Pressable
                                        accessibilityLabel="Change password"
                                        accessibilityRole="button"
                                        hitSlop={10}
                                        onPress={() => setEditingPassword(true)}
                                        style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? colors.pressed : 'transparent' }]}
                                    >
                                        <Ionicons name="pencil-outline" size={20} color={colors.icons} />
                                    </Pressable>
                                )}
                            </View>
                            {editingPassword && (
                                <View style={styles.passwordForm}>
                                    <TextInput
                                        accessibilityLabel="Current password"
                                        value={currentPassword}
                                        onChangeText={(value) => { setCurrentPassword(value); setPasswordError(null); }}
                                        placeholder="Current password"
                                        placeholderTextColor={colors.secondaryText}
                                        secureTextEntry
                                        autoComplete="current-password"
                                        editable={!savingPassword}
                                        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                                    />
                                    <TextInput
                                        accessibilityLabel="New password"
                                        value={newPassword}
                                        onChangeText={(value) => { setNewPassword(value); setPasswordError(null); }}
                                        placeholder="New password"
                                        placeholderTextColor={colors.secondaryText}
                                        secureTextEntry
                                        autoComplete="new-password"
                                        editable={!savingPassword}
                                        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                                    />
                                    <TextInput
                                        accessibilityLabel="Confirm new password"
                                        value={confirmPassword}
                                        onChangeText={(value) => { setConfirmPassword(value); setPasswordError(null); }}
                                        placeholder="Confirm new password"
                                        placeholderTextColor={colors.secondaryText}
                                        secureTextEntry
                                        autoComplete="new-password"
                                        editable={!savingPassword}
                                        returnKeyType="done"
                                        onSubmitEditing={handleChangePassword}
                                        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
                                    />
                                    {passwordError && <Text accessibilityRole="alert" style={{ color: colors.error }}>{passwordError}</Text>}
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityState={{ disabled: savingPassword, busy: savingPassword }}
                                        disabled={savingPassword}
                                        onPress={handleChangePassword}
                                        style={({ pressed }) => [styles.button, { backgroundColor: colors.button, opacity: pressed || savingPassword ? 0.6 : 1 }]}
                                    >
                                        {savingPassword && <ActivityIndicator color={colors.buttonText} />}
                                        <Text style={[styles.buttonText, { color: colors.buttonText }]}>{savingPassword ? 'Updating...' : 'Update password'}</Text>
                                    </Pressable>
                                    <Pressable accessibilityRole="button" disabled={savingPassword} onPress={cancelPasswordEdit} style={styles.cancelButton}>
                                        <Text style={{ color: colors.secondaryText }}>Cancel</Text>
                                    </Pressable>
                                </View>
                            )}
                        </View>
                        {error && (
                            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, { color: colors.error }]}>{error}</Text>
                        )}
                        <View style={styles.footer}>
                        <Pressable
                            onPress={handleSignOut}
                            disabled={signingOut || savingUsername || savingPassword}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: signingOut || savingUsername || savingPassword, busy: signingOut }}
                            style={({ pressed }) => [styles.signOutButton, { borderColor: colors.error, opacity: signingOut ? 0.6 : pressed ? 0.75 : 1 }]}
                        >
                            {signingOut && <ActivityIndicator color={colors.error} />}
                            <Text style={[styles.buttonText, { color: colors.error }]}>{signingOut ? 'Signing out...' : 'Sign out'}</Text>
                        </Pressable>
                        </View>
                    </View>
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
  completeProfile: {
    gap: 12,
    marginBottom: 20,
  },
  passwordForm: {
    gap: 12,
    marginBottom: 20,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  settingValue: {
    flex: 1,
    marginBottom: 0,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 50,
    fontSize: 16,
  },
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
    padding: 24,
  },
  container: {
    flex: 1,
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
    marginBottom: 24,
  },
  card: {
    padding: 20,
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    marginBottom: 6,
  },
  value: {
    fontSize: 16,
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
  footer: {
    marginTop: 'auto',
    paddingTop: 32,
  },
  signOutButton: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
