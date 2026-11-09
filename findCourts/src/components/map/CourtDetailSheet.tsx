import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Linking,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CourtCluster } from '@/type/CourtCluster';
import { useAppTheme } from '@/theme/appTheme';
import { useAuth } from '@/context/AuthContext';
import {
    deleteReview,
    getReviews,
    type Review,
} from '@/services/reviews';
import CourtPhotos, { type CourtPhotosHandle } from '@/components/map/CourtPhotos';
import Ionicons from '@expo/vector-icons/Ionicons';

type Props = {
    cluster: CourtCluster | null;
    onClose: () => void;
};

type SheetMode = 'collapsed' | 'default' | 'expanded';

type DetailTab = 'overview' | 'photos' | 'reviews';

const MAX_VISIBLE_REVIEWS = 50;

type DetailTabButtonProps = {
    tab: DetailTab;
    active: boolean;
    textColor: string;
    pressedColor: string;
    onPress: () => void;
};

const SPRING_CONFIG = {
    useNativeDriver: true,
    damping: 22,
    stiffness: 190,
    overshootClamping: true,
} as const;

function DetailTabButton({
    tab,
    active,
    textColor,
    pressedColor,
    onPress,
}: DetailTabButtonProps) {
    const [pressProgress] = useState(() => new Animated.Value(0));

    function releasePress() {
        Animated.spring(pressProgress, {
            toValue: 0,
            useNativeDriver: true,
            damping: 18,
            stiffness: 240,
            overshootClamping: true,
        }).start();
    }

    return (
        <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={onPress}
            onPressIn={() => {
                pressProgress.stopAnimation();
                pressProgress.setValue(1);
            }}
            onPressOut={releasePress}
            style={styles.tab}
        >
            <Animated.View
                pointerEvents="none"
                style={[
                    styles.tabPressBackground,
                    {
                        backgroundColor: pressedColor,
                        opacity: pressProgress,
                    },
                ]}
            />
            <Text style={[styles.tabText, { color: textColor }]}>
                {tab[0].toUpperCase() + tab.slice(1)}
            </Text>
        </Pressable>
    );
}

async function openCourtNavigation(latitude: number, longitude: number) {
    const destination = `${latitude},${longitude}`;
    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&dir_action=navigate`;
    const nativeMapsUrl = Platform.select({
        android: `geo:0,0?q=${encodeURIComponent(destination)}`,
        ios: `maps://?daddr=${encodeURIComponent(destination)}&dirflg=d`,
        default: googleMapsUrl,
    });

    try {
        await Linking.openURL(nativeMapsUrl);
    } catch {
        await Linking.openURL(googleMapsUrl);
    }
}

export default function CourtDetailsSheet({ cluster, onClose }: Props) {
    const { height: screenHeight, width: screenWidth } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { colors } = useAppTheme();
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<DetailTab>('overview');
    const [translateY] = useState(() => new Animated.Value(screenHeight));
    const [tabPosition] = useState(() => new Animated.Value(0));
    const [reviews, setReviews] = useState<Review[]>([]);
    const [myReview, setMyReview] = useState<Review | null>(null);
    const [reviewCount, setReviewCount] = useState(0);
    const [averageRating, setAverageRating] = useState<number | null>(null);
    const [reviewsLoading, setReviewsLoading] = useState(false);
    const [reviewsLoadingMore, setReviewsLoadingMore] = useState(false);
    const [nextReviewOffset, setNextReviewOffset] = useState(20);
    const [hasMoreReviews, setHasMoreReviews] = useState(false);
    const [reviewSaving, setReviewSaving] = useState(false);
    const [reviewError, setReviewError] = useState<string | null>(null);
    const mode = useRef<SheetMode>('default');
    const suppressHeaderPress = useRef(false);
    const loadMorePending = useRef(false);
    const photosRef = useRef<CourtPhotosHandle>(null);
    const isOpen = cluster !== null;
    const courtId = cluster?.courts[0]?.id ?? null;
    const tabWidth = (screenWidth - 40) / 3;

    // Positions of the top edge of the full-height sheet.
    const expandedY = insets.top + 64;
    const defaultY = Math.max(expandedY + 180, screenHeight - 360);
    const collapsedY = screenHeight - 96 - insets.bottom;
    const hiddenY = screenHeight + 20;
    const dragStartY = useRef(defaultY);
    const currentY = useRef(defaultY);

    useEffect(() => {
        const resetTimer = setTimeout(() => setActiveTab('overview'), 0);
        return () => clearTimeout(resetTimer);
    }, [courtId]);

    useEffect(() => {
        const tabIndex = { overview: 0, photos: 1, reviews: 2 }[activeTab];
        Animated.spring(tabPosition, {
            toValue: tabIndex,
            useNativeDriver: true,
            damping: 25,
            stiffness: 140,
            overshootClamping: true,
        }).start();
    }, [activeTab, tabPosition]);

    useEffect(() => {
        const listenerId = translateY.addListener(({ value }) => {
            currentY.current = value;
        });

        return () => translateY.removeListener(listenerId);
    }, [translateY]);

    function animateTo(nextMode: SheetMode) {
        const destination = {
            expanded: expandedY,
            default: defaultY,
            collapsed: collapsedY,
        }[nextMode];

        translateY.stopAnimation();
        mode.current = nextMode;
        Animated.spring(translateY, {
            toValue: destination,
            ...SPRING_CONFIG,
        }).start();
    }

    function handleHeaderPress() {
        if (suppressHeaderPress.current) return;

        if (mode.current === 'expanded') {
            animateTo('default');
        } else if (mode.current === 'default') {
            animateTo('expanded');
        } else {
            animateTo('default');
        }
    }

    useEffect(() => {
        translateY.stopAnimation();

        if (!isOpen) {
            translateY.setValue(hiddenY);
            return;
        }

        // Every marker selection opens from below at the default snap point.
        mode.current = 'default';
        translateY.setValue(hiddenY);
        Animated.spring(translateY, {
            toValue: defaultY,
            ...SPRING_CONFIG,
        }).start();
    }, [isOpen, defaultY, hiddenY, translateY]);

    useFocusEffect(useCallback(() => {
        let cancelled = false;
        if (!courtId) return;
        const loadingTimer = setTimeout(() => {
            if (cancelled) return;
            setReviewsLoading(true);
            setReviewError(null);
        }, 0);
        getReviews(courtId, user).then((page) => {
            if (cancelled) return;
            setReviews(page.reviews);
            setMyReview(page.myReview);
            setReviewCount(page.count);
            setAverageRating(page.averageRating);
            setNextReviewOffset(page.offset + page.limit);
            setHasMoreReviews(page.offset + page.limit < Math.min(page.count, MAX_VISIBLE_REVIEWS));
        }).catch((error) => {
            if (!cancelled) {
                setReviewError(error instanceof Error ? error.message : 'Unable to load reviews.');
            }
        }).finally(() => {
            if (!cancelled) setReviewsLoading(false);
        });
        return () => {
            cancelled = true;
            clearTimeout(loadingTimer);
        };
    }, [courtId, user]));

    function handleClose() {
        translateY.stopAnimation();
        Animated.spring(translateY, {
            toValue: hiddenY,
            ...SPRING_CONFIG,
        }).start(({ finished }) => {
            if (finished) onClose();
        });
    }

    async function removeOwnReview() {
        if (!courtId || !user || !myReview || reviewSaving) return;
        setReviewSaving(true);
        setReviewError(null);
        try {
            await deleteReview(user, courtId);
            setReviews((current) => current.filter((review) => !review.is_mine));
            setMyReview(null);
            setAverageRating(reviewCount > 1 && averageRating !== null
                ? ((averageRating * reviewCount) - myReview.rating) / (reviewCount - 1)
                : null);
            setReviewCount((count) => Math.max(0, count - 1));
        } catch (error) {
            setReviewError(error instanceof Error ? error.message : 'Unable to delete your review.');
        } finally {
            setReviewSaving(false);
        }
    }

    function confirmDeleteReview() {
        Alert.alert('Delete review?', 'This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => { removeOwnReview().catch(() => {}); } },
        ]);
    }

    function openReviewScreen(selectedRating: number) {
        if (!courtId) return;
        if (!user) {
            router.push('/login');
            return;
        }
        router.push({
            pathname: '/review',
            params: {
                courtId,
                courtName: cluster?.courts[0]?.name ?? 'Court',
                rating: selectedRating.toString(),
            },
        });
    }

    async function loadMoreReviews() {
        if (!courtId || reviewsLoading || loadMorePending.current || !hasMoreReviews) return;
        loadMorePending.current = true;
        setReviewsLoadingMore(true);
        try {
            const page = await getReviews(courtId, user, nextReviewOffset);
            setReviews((current) => {
                const knownIds = new Set(current.map((review) => review.id));
                return [...current, ...page.reviews.filter((review) => !knownIds.has(review.id))];
            });
            const newOffset = page.offset + page.limit;
            setNextReviewOffset(newOffset);
            setHasMoreReviews(newOffset < Math.min(page.count, MAX_VISIBLE_REVIEWS));
            setMyReview(page.myReview);
            setReviewCount(page.count);
            setAverageRating(page.averageRating);
        } catch (error) {
            setReviewError(error instanceof Error ? error.message : 'Unable to load more reviews.');
        } finally {
            loadMorePending.current = false;
            setReviewsLoadingMore(false);
        }
    }

    // Track the sheet position while dragging anywhere on its surface.
    // The refs below are only read by gesture callbacks, never during render.
    // eslint-disable-next-line react-hooks/refs
    const panResponder = PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
            Math.abs(gesture.dy) > 6
            && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.2,
        onPanResponderGrant: () => {
            translateY.stopAnimation();
            dragStartY.current = currentY.current;
        },
        onPanResponderMove: (_, gesture) => {
            currentY.current = Math.min(
                collapsedY,
                Math.max(expandedY, dragStartY.current + gesture.dy),
            );
            translateY.setValue(currentY.current);
        },
        onPanResponderRelease: (_, gesture) => {
            // A Pressable can occasionally receive the touch release that
            // ended this drag. Keep that release from toggling the header.
            suppressHeaderPress.current = true;
            setTimeout(() => {
                suppressHeaderPress.current = false;
            }, 200);
            const projectedY = currentY.current + gesture.vy * 120;
            const allSnapPoints: { mode: SheetMode; y: number }[] = [
                { mode: 'expanded', y: expandedY },
                { mode: 'default', y: defaultY },
                { mode: 'collapsed', y: collapsedY },
            ];
            const collapsedZoneStart = (defaultY + collapsedY) / 2;
            // stop a drag from going from expanded to collapsed
            const snapPoints = mode.current === 'expanded'
                && currentY.current < collapsedZoneStart
                ? allSnapPoints.filter((point) => point.mode !== 'collapsed')
                : allSnapPoints;
            const nearest = snapPoints.reduce((best, point) =>
                Math.abs(point.y - projectedY) < Math.abs(best.y - projectedY)
                    ? point
                    : best,
            );

            animateTo(nearest.mode);
        },
        onPanResponderTerminate: () => {
            suppressHeaderPress.current = true;
            setTimeout(() => {
                suppressHeaderPress.current = false;
            }, 200);
            animateTo(mode.current);
        },
    });

    if (!cluster) return null;

    const firstCourt = cluster.courts[0];
    const sports = [...new Set(cluster.courts.map((court) => court.sport))];
    const displayedReviews = myReview && !reviews.some((review) => review.id === myReview.id)
        ? [myReview, ...reviews]
        : reviews;
    return (
        <Animated.View
            style={[
                styles.sheet,
                {
                    height: screenHeight - expandedY,
                    paddingBottom: insets.bottom + 20,
                    transform: [{ translateY }],
                    backgroundColor: colors.surface,
                    shadowColor: colors.shadow,
                },
            ]}
        >
            <View style={styles.dragArea} {...panResponder.panHandlers}>
                <Pressable onPress={handleHeaderPress}>
                    <View style={[styles.handle, { backgroundColor: colors.border }]} />
                </Pressable>

                <View style={styles.heading}>
                    <Pressable style={styles.headingText} onPress={handleHeaderPress}>
                        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                            {firstCourt?.name ?? 'Court details'}
                        </Text>
                        <Text
                            style={[styles.collapsedSport, { color: colors.secondaryText }]}
                            numberOfLines={1}
                        >
                            {sports.join(', ')}
                        </Text>
                    </Pressable>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close court details"
                        hitSlop={12}
                        onPress={handleClose}
                        style={[styles.closeButton, { backgroundColor: colors.pressed }]}
                    >
                        <Ionicons name="close" size={22} color={colors.icons} />
                    </Pressable>
                </View>

                <Text style={[styles.label, { color: colors.secondaryText }]}>Address</Text>
                <Text style={[styles.value, { color: colors.text }]}>
                    {firstCourt?.address ?? 'Address unavailable'}
                </Text>
                {cluster.courts.length > 1 && (
                    <Text style={[styles.count, { color: colors.secondaryText }]}>
                        {cluster.courts.length} courts at this location
                    </Text>
                )}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open court reviews"
                    onPress={() => setActiveTab('reviews')}
                    style={styles.ratingSummary}
                >
                    <Ionicons name="star" size={18} color="#f5a623" />
                    <Text style={[styles.ratingSummaryText, { color: colors.text }]}>
                        {averageRating === null ? 'No ratings yet' : averageRating.toFixed(1)}
                    </Text>
                    {reviewCount > 0 && (
                        <Text style={[styles.ratingSummaryCount, { color: colors.secondaryText }]}>
                            · {reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}
                        </Text>
                    )}
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Navigate to court"
                    onPress={() => {
                        if (!firstCourt) return;
                        openCourtNavigation(firstCourt.latitude, firstCourt.longitude).catch(() => {});
                    }}
                    style={[styles.navigateButton, { backgroundColor: colors.button }]}
                >
                    <Text style={[styles.navigateButtonText, { color: colors.buttonText }]}>Navigate</Text>
                </Pressable>
            </View>
            <View style={[styles.headerDivider, { backgroundColor: colors.border }]} />
            <View style={[styles.tabs, { borderBottomColor: colors.border }]}>
                <Animated.View
                    pointerEvents="none"
                    style={[
                        styles.tabIndicator,
                        {
                            left: 20,
                            width: tabWidth,
                            backgroundColor: colors.primary,
                            transform: [{
                                translateX: tabPosition.interpolate({
                                    inputRange: [0, 1, 2],
                                    outputRange: [0, tabWidth, tabWidth * 2],
                                }),
                            }],
                        },
                    ]}
                />
                {(['overview', 'photos', 'reviews'] as const).map((tab) => (
                    <DetailTabButton
                        key={tab}
                        tab={tab}
                        active={activeTab === tab}
                        onPress={() => setActiveTab(tab)}
                        textColor={activeTab === tab ? colors.primary : colors.secondaryText}
                        pressedColor={colors.pressed}
                    />
                ))}
            </View>

            <ScrollView
                style={styles.contentScroll}
                contentContainerStyle={styles.content}
                scrollEventThrottle={200}
                onScroll={({ nativeEvent }) => {
                    const nearBottom = nativeEvent.layoutMeasurement.height + nativeEvent.contentOffset.y
                        >= nativeEvent.contentSize.height - 140;
                    if (activeTab === 'reviews' && nearBottom) loadMoreReviews().catch(() => {});
                    if (activeTab === 'photos' && nearBottom) photosRef.current?.loadMore();
                }}
            >
                {activeTab === 'overview' && (
                    <>
                        {courtId && (
                            <CourtPhotos
                                courtId={courtId}
                                mode="preview"
                                onSeeAll={() => setActiveTab('photos')}
                            />
                        )}

                        <View style={[styles.sectionHeading, styles.overviewReviewHeading]}>
                            <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent reviews</Text>
                            <Pressable onPress={() => setActiveTab('reviews')}>
                                <Text style={{ color: colors.primary }}>See all</Text>
                            </Pressable>
                        </View>
                        {reviewError && (
                            <Text accessibilityRole="alert" style={[styles.reviewError, { color: colors.error }]}>
                                {reviewError}
                            </Text>
                        )}
                        {reviewsLoading ? (
                            <ActivityIndicator style={styles.reviewsLoading} color={colors.button} />
                        ) : reviews.length === 0 ? (
                            <Text style={[styles.emptyReviews, { color: colors.secondaryText }]}>No reviews yet.</Text>
                        ) : reviews.slice(0, 2).map((review) => (
                            <View key={review.id} style={[styles.review, { borderBottomColor: colors.border }]}>
                                <View style={styles.reviewHeader}>
                                    <Text style={[styles.reviewUsername, { color: colors.text }]}>{review.username}</Text>
                                    <Text style={[styles.reviewDate, { color: colors.secondaryText }]}>
                                        {new Date(review.created_at).toLocaleDateString()}
                                    </Text>
                                </View>
                                <View style={styles.reviewStars}>
                                    {[1, 2, 3, 4, 5].map((value) => (
                                        <Ionicons key={value} name={value <= review.rating ? 'star' : 'star-outline'}
                                            size={17} color={value <= review.rating ? '#f5a623' : colors.icons} />
                                    ))}
                                </View>
                                {review.comment && (
                                    <Text style={[styles.reviewComment, { color: colors.text }]} numberOfLines={3}>
                                        {review.comment}
                                    </Text>
                                )}
                            </View>
                        ))}

                        <View style={[styles.ratingPrompt, { borderTopColor: colors.border }]}>
                            <Text style={[styles.ratingPromptTitle, { color: colors.text }]}>
                                {myReview ? 'Update your review' : 'Rate this court'}
                            </Text>
                            <View style={styles.promptStars} accessibilityRole="radiogroup">
                                {[1, 2, 3, 4, 5].map((value) => (
                                    <Pressable key={value} accessibilityRole="radio"
                                        accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`}
                                        onPress={() => openReviewScreen(value)} hitSlop={6}>
                                        <Ionicons name={myReview && value <= myReview.rating ? 'star' : 'star-outline'}
                                            size={34} color={myReview && value <= myReview.rating ? '#f5a623' : colors.icons} />
                                    </Pressable>
                                ))}
                            </View>
                            <Text style={[styles.ratingPromptHint, { color: colors.secondaryText }]}>
                                Tap a star to {myReview ? 'edit' : 'write'} your review
                            </Text>
                        </View>
                    </>
                )}

                {activeTab === 'photos' && (
                    courtId && <CourtPhotos ref={photosRef} courtId={courtId} mode="gallery" />
                )}

                {activeTab === 'reviews' && (
                    <>
                        <View style={styles.sectionHeading}>
                            <Text style={[styles.sectionTitle, { color: colors.text }]}>Reviews</Text>
                            <Text style={[styles.reviewCount, { color: colors.secondaryText }]}>
                                {reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}
                            </Text>
                        </View>
                        <View style={[styles.reviewTabPrompt, { borderColor: colors.border }]}>
                            <Text style={[styles.reviewTabPromptTitle, { color: colors.text }]}>
                                {myReview ? 'Update your review' : 'Add a review'}
                            </Text>
                            <View style={styles.reviewTabStars} accessibilityRole="radiogroup">
                                {[1, 2, 3, 4, 5].map((value) => (
                                    <Pressable key={value} accessibilityRole="radio"
                                        accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`}
                                        onPress={() => openReviewScreen(value)} hitSlop={5}>
                                        <Ionicons name={myReview && value <= myReview.rating ? 'star' : 'star-outline'}
                                            size={28} color={myReview && value <= myReview.rating ? '#f5a623' : colors.icons} />
                                    </Pressable>
                                ))}
                            </View>
                        </View>
                        {reviewError && (
                            <Text accessibilityRole="alert" style={[styles.reviewError, { color: colors.error }]}>
                                {reviewError}
                            </Text>
                        )}
                        {reviewsLoading ? (
                            <ActivityIndicator style={styles.reviewsLoading} color={colors.button} />
                        ) : displayedReviews.length === 0 ? (
                            <Text style={[styles.emptyReviews, { color: colors.secondaryText }]}>No reviews yet.</Text>
                        ) : displayedReviews.map((review) => (
                            <View key={review.id} style={[styles.review, { borderBottomColor: colors.border }]}>
                                <View style={styles.reviewHeader}>
                                    <Text style={[styles.reviewUsername, { color: colors.text }]}>{review.username}</Text>
                                    <Text style={[styles.reviewDate, { color: colors.secondaryText }]}>
                                        {new Date(review.created_at).toLocaleDateString()}
                                    </Text>
                                </View>
                                <View style={styles.reviewStars}>
                                    {[1, 2, 3, 4, 5].map((value) => (
                                        <Ionicons key={value} name={value <= review.rating ? 'star' : 'star-outline'}
                                            size={17} color={value <= review.rating ? '#f5a623' : colors.icons} />
                                    ))}
                                </View>
                                {review.comment && (
                                    <Text style={[styles.reviewComment, { color: colors.text }]}>{review.comment}</Text>
                                )}
                                {review.is_mine && (
                                    <View style={styles.reviewActions}>
                                        <Pressable onPress={() => openReviewScreen(review.rating)}>
                                            <Text style={{ color: colors.primary }}>Edit</Text>
                                        </Pressable>
                                        <Pressable onPress={confirmDeleteReview} disabled={reviewSaving}>
                                            <Text style={{ color: colors.error }}>Delete</Text>
                                        </Pressable>
                                    </View>
                                )}
                            </View>
                        ))}
                        {reviewsLoadingMore && (
                            <ActivityIndicator style={styles.loadMoreIndicator} color={colors.button} />
                        )}
                    </>
                )}

                <View style={[styles.attributionFooter, { borderTopColor: colors.border }]}>
                    <Text style={[styles.attributionText, { color: colors.secondaryText }]}>
                        Address data:{' '}
                        <Text style={{ color: colors.primary }} accessibilityRole="link"
                            onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright').catch(() => {})}>
                            OpenStreetMap contributors
                        </Text>
                        {' | '}
                        <Text style={{ color: colors.primary }} accessibilityRole="link"
                            onPress={() => Linking.openURL('https://www.geoapify.com/').catch(() => {})}>
                            Powered by Geoapify
                        </Text>
                    </Text>
                </View>
            </ScrollView>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    sheet: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        elevation: 12,
        shadowOpacity: 0.2,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -3 },
    },
    dragArea: {
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 14,
    },
    headerDivider: {
        height: StyleSheet.hairlineWidth,
        marginHorizontal: 20,
        marginBottom: 14,
    },
    handle: {
        alignSelf: 'center',
        width: 44,
        height: 5,
        marginBottom: 14,
        borderRadius: 3,
    },
    heading: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    headingText: {
        flex: 1,
        marginRight: 16,
    },
    title: {
        fontSize: 21,
        fontWeight: '700',
    },
    collapsedSport: {
        marginTop: 3,
        fontSize: 14,
    },
    close: {
        fontSize: 28,
        lineHeight: 30,
    },
    content: {
        paddingTop: 18,
        paddingHorizontal: 20,
        paddingBottom: 24,
    },
    contentScroll: {
        flex: 1,
    },
    label: {
        marginTop: 12,
        fontSize: 13,
        fontWeight: '600',
    },
    value: {
        marginTop: 4,
        fontSize: 16,
    },
    count: {
        marginTop: 12,
    },
    ratingSummary: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        gap: 4,
    },
    ratingSummaryText: {
        fontSize: 15,
        fontWeight: '700',
    },
    ratingSummaryCount: {
        fontSize: 14,
    },
    tabs: {
        position: 'relative',
        flexDirection: 'row',
        paddingHorizontal: 20,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    tabIndicator: {
        position: 'absolute',
        bottom: -1,
        height: 2,
        borderRadius: 1,
    },
    tab: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        overflow: 'hidden',
    },
    tabPressBackground: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
    },
    tabText: {
        fontSize: 14,
        fontWeight: '600',
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
    },
    sectionHeading: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
    },
    overviewReviewHeading: {
        marginTop: 26,
    },
    reviewCount: {
        fontSize: 13,
    },
    reviewTabPrompt: {
        marginTop: 12,
        padding: 14,
        borderWidth: 1,
        borderRadius: 12,
    },
    reviewTabPromptTitle: {
        fontSize: 15,
        fontWeight: '600',
    },
    reviewTabStars: {
        flexDirection: 'row',
        gap: 5,
        marginTop: 10,
    },
    reviewForm: {
        marginTop: 14,
        padding: 14,
        borderWidth: 1,
        borderRadius: 12,
    },
    formTitle: {
        fontSize: 16,
        fontWeight: '600',
    },
    stars: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 10,
    },
    commentInput: {
        minHeight: 88,
        marginTop: 14,
        padding: 12,
        borderWidth: 1,
        borderRadius: 10,
        fontSize: 15,
    },
    formActions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
        marginTop: 12,
    },
    deleteButton: {
        minHeight: 42,
        paddingHorizontal: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    saveButton: {
        minHeight: 42,
        paddingHorizontal: 16,
        borderRadius: 9,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    saveButtonText: {
        fontWeight: '600',
    },
    loginButton: {
        marginTop: 14,
        minHeight: 48,
        borderWidth: 1,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    reviewError: {
        marginTop: 12,
        fontSize: 14,
        lineHeight: 20,
    },
    reviewsLoading: {
        marginVertical: 28,
    },
    loadMoreIndicator: {
        marginVertical: 20,
    },
    emptyReviews: {
        marginTop: 20,
        fontSize: 15,
    },
    review: {
        paddingVertical: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    reviewHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    reviewUsername: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
    },
    reviewDate: {
        fontSize: 12,
    },
    reviewStars: {
        flexDirection: 'row',
        gap: 2,
        marginTop: 5,
    },
    reviewComment: {
        marginTop: 8,
        fontSize: 15,
        lineHeight: 21,
    },
    reviewActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 20,
        marginTop: 12,
    },
    ratingPrompt: {
        marginTop: 28,
        paddingTop: 22,
        borderTopWidth: StyleSheet.hairlineWidth,
        alignItems: 'center',
    },
    ratingPromptTitle: {
        fontSize: 18,
        fontWeight: '700',
    },
    promptStars: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 12,
    },
    ratingPromptHint: {
        marginTop: 8,
        fontSize: 13,
    },
    emptyTab: {
        minHeight: 250,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 30,
    },
    emptyTabTitle: {
        marginTop: 14,
        fontSize: 18,
        fontWeight: '700',
    },
    emptyTabText: {
        marginTop: 6,
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
    },
    attributionFooter: {
        marginTop: 28,
        paddingTop: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    attributionText: {
        fontSize: 12,
        lineHeight: 17,
        textAlign: 'center',
    },
    closeButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    navigateButton: {
        alignSelf: 'flex-start',
        marginTop: 14,
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 8,
    },
    navigateButtonText: {
        fontSize: 15,
        fontWeight: '600',
    },
});
