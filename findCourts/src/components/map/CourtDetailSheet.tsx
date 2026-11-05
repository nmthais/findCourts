import { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Linking,
    PanResponder,
    Pressable,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CourtCluster } from '@/type/CourtCluster';
import { useAppTheme } from '@/theme/appTheme';

type Props = {
    cluster: CourtCluster | null;
    onClose: () => void;
};

type SheetMode = 'collapsed' | 'default' | 'expanded';

const SPRING_CONFIG = {
    useNativeDriver: true,
    damping: 22,
    stiffness: 190,
    overshootClamping: true,
} as const;

export default function CourtDetailsSheet({ cluster, onClose }: Props) {
    const { height: screenHeight } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { colors } = useAppTheme();
    const [translateY] = useState(() => new Animated.Value(screenHeight));
    const mode = useRef<SheetMode>('default');
    const suppressHeaderPress = useRef(false);
    const isOpen = cluster !== null;

    // Positions of the top edge of the full-height sheet.
    const expandedY = insets.top + 64;
    const defaultY = Math.max(expandedY + 180, screenHeight - 360);
    const collapsedY = screenHeight - 96 - insets.bottom;
    const hiddenY = screenHeight + 20;
    const dragStartY = useRef(defaultY);
    const currentY = useRef(defaultY);

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

    function handleClose() {
        translateY.stopAnimation();
        Animated.spring(translateY, {
            toValue: hiddenY,
            ...SPRING_CONFIG,
        }).start(({ finished }) => {
            if (finished) onClose();
        });
    }

    // Track the sheet position while dragging anywhere on its surface.
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

    return (
        <Animated.View
            {...panResponder.panHandlers}
            style={[
                styles.sheet,
                {
                    height: screenHeight,
                    paddingBottom: insets.bottom + 20,
                    transform: [{ translateY }],
                    backgroundColor: colors.surface,
                    shadowColor: colors.shadow,
                },
            ]}
        >
            <View style={styles.dragArea}>
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
                        <Text style={[styles.close, { color: colors.icons }]}>×</Text>
                    </Pressable>
                </View>
            </View>
            <View style={[styles.headerDivider, { backgroundColor: colors.border }]} />

            <View style={styles.content}>
                <Text style={[styles.label, { color: colors.secondaryText }]}>Sports</Text>
                <Text style={[styles.value, { color: colors.text }]}>{sports.join(', ')}</Text>

                <Text style={[styles.label, { color: colors.secondaryText }]}>Address</Text>
                <Text style={[styles.value, { color: colors.text }]}>
                    {firstCourt?.address ?? 'Address unavailable'}
                </Text>
                <Text style={[styles.label, { color: colors.secondaryText }]}>
                    Address data: {' '}
                    <Text accessibilityRole="link" onPress={() => {
                        Linking.openURL('https://www.openstreetmap.org/copyright').catch(() => {});
                    }}>OpenStreetMap contributors</Text>
                    {' · '}
                    <Text accessibilityRole="link" onPress={() => {
                        Linking.openURL('https://www.geoapify.com/').catch(() => {});
                    }}>Powered by Geoapify</Text>
                </Text>

                {cluster.courts.length > 1 && (
                    <Text style={[styles.count, { color: colors.secondaryText }]}>
                        {cluster.courts.length} courts at this location
                    </Text>
                )}

                <View style={[styles.fullDetails, { borderTopColor: colors.border }]}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>More information</Text>
                    <Text style={[styles.placeholderText, { color: colors.secondaryText }]}>
                        Photos, facilities, reviews and other community details can be added here.
                    </Text>
                </View>
            </View>
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
        paddingHorizontal: 20,
        paddingBottom: 24,
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
        marginTop: 20,
    },
    fullDetails: {
        marginTop: 28,
        paddingTop: 22,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
    },
    placeholderText: {
        marginTop: 8,
        fontSize: 15,
        lineHeight: 22,
    },
    closeButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
