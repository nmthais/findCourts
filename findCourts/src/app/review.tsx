import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@/context/AuthContext';
import { useAppTheme } from '@/theme/appTheme';
import { getReviews, saveReview } from '@/services/reviews';

function initialRating(value: string | string[] | undefined) {
    const rating = Number(Array.isArray(value) ? value[0] : value);
    return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : 0;
}

export default function ReviewScreen() {
    const params = useLocalSearchParams<{ courtId?: string; courtName?: string; rating?: string }>();
    const courtId = Array.isArray(params.courtId) ? params.courtId[0] : params.courtId;
    const courtName = Array.isArray(params.courtName) ? params.courtName[0] : params.courtName;
    const { colors } = useAppTheme();
    const { user, loading } = useAuth();
    const [rating, setRating] = useState(() => initialRating(params.rating));
    const [comment, setComment] = useState('');
    const [loadingReview, setLoadingReview] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (loading) return;
        if (!user || !courtId) {
            router.replace('/login');
            return;
        }
        let cancelled = false;
        getReviews(courtId, user).then((page) => {
            if (cancelled) return;
            const ownReview = page.myReview;
            if (ownReview) {
                setComment(ownReview.comment ?? '');
                if (initialRating(params.rating) === 0) setRating(ownReview.rating);
            }
        }).catch((loadError) => {
            if (!cancelled) {
                setError(loadError instanceof Error ? loadError.message : 'Unable to load your review.');
            }
        }).finally(() => {
            if (!cancelled) setLoadingReview(false);
        });
        return () => {
            cancelled = true;
        };
    }, [courtId, loading, params.rating, user]);

    async function handleSave() {
        if (!user || !courtId || rating === 0 || saving) return;
        setSaving(true);
        setError(null);
        try {
            await saveReview(user, courtId, rating, comment);
            router.back();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Unable to save your review.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
            <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <Text pointerEvents="none" style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
                    Write a review
                </Text>
                <Pressable
                    onPress={() => router.back()}
                    accessibilityRole="button"
                    hitSlop={10}
                    style={styles.closeButton}
                >
                    <Ionicons name="close" size={26} color={colors.icons} />
                </Pressable>
            </View>
            <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                    <Text style={[styles.courtName, { color: colors.text }]}>{courtName ?? 'Court'}</Text>
                    <Text style={[styles.prompt, { color: colors.secondaryText }]}>How was your experience?</Text>

                    <View style={styles.stars} accessibilityRole="radiogroup">
                        {[1, 2, 3, 4, 5].map((value) => (
                            <Pressable key={value} accessibilityRole="radio"
                                accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`}
                                accessibilityState={{ checked: rating === value }}
                                onPress={() => setRating(value)} disabled={saving} hitSlop={6}>
                                <Ionicons name={value <= rating ? 'star' : 'star-outline'} size={42}
                                    color={value <= rating ? '#f5a623' : colors.icons} />
                            </Pressable>
                        ))}
                    </View>

                    {loadingReview ? (
                        <ActivityIndicator style={styles.loader} color={colors.button} />
                    ) : (
                        <TextInput
                            style={[
                                styles.comment,
                                { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
                            ]}
                            value={comment}
                            onChangeText={setComment}
                            placeholder="Share details about the court (optional)"
                            placeholderTextColor={colors.secondaryText}
                            multiline
                            maxLength={2000}
                            editable={!saving}
                            textAlignVertical="top"
                        />
                    )}
                    <Text style={[styles.characterCount, { color: colors.secondaryText }]}>
                        {comment.length}/2000
                    </Text>
                    {error && (
                        <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{error}</Text>
                    )}
                    <Pressable
                        onPress={handleSave}
                        disabled={saving || loadingReview || rating === 0}
                        style={[
                            styles.saveButton,
                            {
                                backgroundColor: colors.button,
                                opacity: saving || loadingReview || rating === 0 ? 0.55 : 1,
                            },
                        ]}
                    >
                        {saving && <ActivityIndicator size="small" color={colors.buttonText} />}
                        <Text style={[styles.saveButtonText, { color: colors.buttonText }]}>Save review</Text>
                    </Pressable>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
    },
    header: {
        minHeight: 56,
        paddingHorizontal: 18,
        borderBottomWidth: StyleSheet.hairlineWidth,
        justifyContent: 'center',
    },
    headerTitle: {
        position: 'absolute',
        left: 60,
        right: 60,
        fontSize: 17,
        fontWeight: '700',
        textAlign: 'center',
    },
    closeButton: {
        position: 'absolute',
        right: 18,
        zIndex: 1,
    },
    content: {
        padding: 24,
    },
    courtName: {
        fontSize: 24,
        fontWeight: '700',
        textAlign: 'center',
    },
    prompt: {
        marginTop: 8,
        fontSize: 15,
        textAlign: 'center',
    },
    stars: {
        flexDirection: 'row',
        alignSelf: 'center',
        gap: 10,
        marginTop: 24,
    },
    loader: {
        marginTop: 36,
    },
    comment: {
        minHeight: 160,
        marginTop: 30,
        padding: 14,
        borderWidth: 1,
        borderRadius: 12,
        fontSize: 16,
    },
    characterCount: {
        marginTop: 6,
        fontSize: 12,
        textAlign: 'right',
    },
    error: {
        marginTop: 14,
        fontSize: 14,
        lineHeight: 20,
    },
    saveButton: {
        minHeight: 50,
        marginTop: 20,
        paddingHorizontal: 18,
        borderRadius: 11,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    saveButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
});
