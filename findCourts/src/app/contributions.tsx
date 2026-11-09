import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { User } from 'firebase/auth';
import AccountBackButton from '@/components/AccountBackButton';
import { useAuth } from '@/context/AuthContext';
import { useCourtsContext } from '@/context/CourtsContext';
import { useAppTheme } from '@/theme/appTheme';
import { getContributions, type Contribution, type ContributionTab } from '@/services/contributions';
import { focusCourtInCluster } from '@/utils/focusCourtInCluster';

function dateLabel(value: string) {
    return new Date(value).toLocaleString('en-AU', {
        day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
}

function HistoryList({ user, tab }: { user: User; tab: ContributionTab }) {
    const insets = useSafeAreaInsets();
    const { colors } = useAppTheme();
    const { courtClusters, setSelectedCluster } = useCourtsContext();
    const [items, setItems] = useState<Contribution[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<Contribution | null>(null);
    const generation = useRef(0);
    const pending = useRef(false);

    const refresh = useCallback(async () => {
        const current = ++generation.current;
        pending.current = true;
        setLoading(true);
        setLoadingMore(false);
        setError(null);
        setPreview(null);
        try {
            const page = await getContributions(user, tab);
            if (generation.current !== current) return;
            setItems(page.items);
            setCursor(page.nextCursor);
        } catch (err) {
            if (generation.current === current) setError(err instanceof Error ? err.message : 'Unable to load contributions.');
        } finally {
            if (generation.current === current) {
                pending.current = false;
                setLoading(false);
            }
        }
    }, [user, tab]);

    useFocusEffect(useCallback(() => {
        void refresh();
        return () => { generation.current += 1; };
    }, [refresh]));

    async function loadMore() {
        if (pending.current || !cursor) return;
        const current = generation.current;
        pending.current = true;
        setLoadingMore(true);
        setError(null);
        try {
            const page = await getContributions(user, tab, cursor);
            if (generation.current !== current) return;
            setItems((previous) => {
                const known = new Set(previous.map((item) => item.id));
                return [...previous, ...page.items.filter((item) => !known.has(item.id))];
            });
            setCursor(page.nextCursor);
        } catch (err) {
            if (generation.current === current) setError(err instanceof Error ? err.message : 'Unable to load contributions.');
        } finally {
            if (generation.current === current) {
                pending.current = false;
                setLoadingMore(false);
            }
        }
    }

    function openCourt(item: Contribution) {
        const court = item.court;
        const cluster = courtClusters.find((entry) => entry.courts.some((entryCourt) => entryCourt.id === court.id));
        setSelectedCluster({
            ...focusCourtInCluster(cluster ?? {
                id: court.id, courts: [court], latitude: court.latitude, longitude: court.longitude,
            }, court.id),
            selectedCourtId: court.id,
        });
        router.dismissTo('/');
    }

    return (
        <>
            <FlatList
                data={items}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                refreshing={loading}
                onRefresh={() => void refresh()}
                ListHeaderComponent={error ? (
                    <View style={styles.notice}>
                        <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text>
                        <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.action}>
                            <Text style={{ color: colors.primary }}>Retry</Text>
                        </Pressable>
                    </View>
                ) : undefined}
                ListEmptyComponent={loading ? <ActivityIndicator color={colors.button} style={styles.notice} /> : !error ? (
                    <Text style={[styles.notice, { color: colors.secondaryText }]}>
                        {tab === 'reviews' ? 'You haven’t published any reviews yet.' : 'You haven’t uploaded any photos yet.'}
                    </Text>
                ) : undefined}
                renderItem={({ item }) => (
                    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        {tab === 'photos' && (
                            <Pressable accessibilityRole="button" accessibilityLabel={`View photo of ${item.court.name}`}
                                onPress={() => setPreview(item)}>
                                <Image source={{ uri: item.cloudinary_secure_url }} style={styles.photo} contentFit="cover" />
                            </Pressable>
                        )}
                        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.court.name}`}
                            onPress={() => openCourt(item)} style={styles.courtLink}>
                            <Text style={[styles.courtName, { color: colors.primary }]}>{item.court.name}</Text>
                        </Pressable>
                        {tab === 'reviews' && (
                            <>
                                <Text accessibilityLabel={`${item.rating} out of 5 stars`} style={[styles.rating, { color: colors.text }]}>
                                    {'★'.repeat(item.rating ?? 0)}{'☆'.repeat(5 - (item.rating ?? 0))} · {item.rating}/5
                                </Text>
                                <Text style={[styles.comment, { color: colors.text }]}>{item.comment || 'Rating only'}</Text>
                            </>
                        )}
                        <Text style={[styles.date, { color: colors.secondaryText }]}>
                            {tab === 'reviews' ? 'Reviewed' : 'Uploaded'} {dateLabel(item.created_at)}
                        </Text>
                        {tab === 'reviews' && item.updated_at && Date.parse(item.updated_at) > Date.parse(item.created_at) + 1000 && (
                            <Text style={[styles.date, { color: colors.secondaryText }]}>Edited {dateLabel(item.updated_at)}</Text>
                        )}
                    </View>
                )}
                ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.button} /> : cursor ? (
                    <Pressable accessibilityRole="button" disabled={loading} onPress={() => void loadMore()} style={styles.action}>
                        <Text style={{ color: colors.primary }}>Load more</Text>
                    </Pressable>
                ) : undefined}
            />
            <Modal visible={preview !== null} animationType="fade" presentationStyle="fullScreen"
                statusBarTranslucent onRequestClose={() => setPreview(null)}>
                <SafeAreaView style={styles.viewer}>
                    {preview && <Image source={{ uri: preview.cloudinary_secure_url }}
                        contentFit="contain" transition={150} style={styles.viewerImage} />}
                    <Pressable accessibilityRole="button" accessibilityLabel="Close full-screen photo"
                        hitSlop={10} onPress={() => setPreview(null)}
                        style={[styles.viewerClose, { top: insets.top + 12 }]}>
                        <Ionicons name="close" size={28} color="#ffffff" />
                    </Pressable>
                </SafeAreaView>
            </Modal>
        </>
    );
}

export default function Contributions() {
    const { user, loading } = useAuth();
    const { colors } = useAppTheme();
    const [tab, setTab] = useState<ContributionTab>('reviews');
    return (
        <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
            <Stack.Screen options={{ headerShown: false }} />
            <AccountBackButton />
            <Text style={[styles.title, { color: colors.text }]}>My contributions</Text>
            {loading ? <ActivityIndicator color={colors.button} /> : !user ? (
                <View style={styles.notice}>
                    <Text style={{ color: colors.text }}>Log in to view your reviews and photos.</Text>
                    <Pressable accessibilityRole="button" onPress={() => router.push('/login')} style={styles.action}>
                        <Text style={{ color: colors.primary }}>Log in</Text>
                    </Pressable>
                </View>
            ) : (
                <>
                    <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
                        {(['reviews', 'photos'] as const).map((value) => (
                            <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }}
                                onPress={() => setTab(value)} style={[styles.tab, { borderBottomColor: tab === value ? colors.primary : 'transparent' }]}>
                                <Text style={{ color: tab === value ? colors.primary : colors.secondaryText }}>
                                    {value === 'reviews' ? 'Reviews' : 'Photos'}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                    <HistoryList key={`${user.uid}:${tab}`} user={user} tab={tab} />
                </>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginHorizontal: 24,
    marginVertical: 16,
  },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 24,
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 2,
  },
  list: {
    padding: 24,
    gap: 16,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  photo: {
    width: '100%',
    height: 200,
    borderRadius: 8,
  },
  courtLink: {
    minHeight: 44,
    justifyContent: 'center',
  },
  courtName: {
    fontSize: 18,
    fontWeight: '600',
  },
  rating: {
    fontSize: 18,
    marginBottom: 8,
  },
  comment: {
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 8,
  },
  date: {
    fontSize: 13,
    marginTop: 4,
  },
  notice: {
    padding: 24,
  },
  action: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewer: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },
  viewerClose: {
    position: 'absolute',
    right: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
