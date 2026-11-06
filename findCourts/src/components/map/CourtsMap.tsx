import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import MapView, { type Region } from 'react-native-maps';
import Ionicons from '@expo/vector-icons/Ionicons';
import CourtsMarker from './CourtsMarker';
import { responsiveFontSize } from '@/utils/resposiveStyles';
import { router } from 'expo-router';
import { useResponsiveTopOffset } from '@/hooks/useResponsiveTopOffset';
import { useCourtsContext } from '@/context/CourtsContext';
import { useAppTheme } from '@/theme/appTheme';
import { requestForegroundPermissionsAsync, getCurrentPositionAsync } from 'expo-location';
import CourtDetailsSheet from './CourtDetailSheet';

const NEARBY_REGION_DELTA = 0.12;
type LocationStatus =
    | 'checking'
    | 'granted'
    | 'denied';

export default function Map() {
    const { colors } = useAppTheme();
    const controlsTop = useResponsiveTopOffset();
    const mapRef = useRef<MapView>(null);
    const [locationStatus, setLocationStatus] = useState<LocationStatus>('checking');
    const [locationError, setLocationError] = useState<string | null>(null);
    const [markerSize, setMarkerSize] = useState(30);
    const {
        courts,
        courtClusters,
        courtsLoading,
        courtsError,
        cacheLoadFinished,
        loadCourts,
        selectedCluster,
        setSelectedCluster,
    } = useCourtsContext();

    const selectedClusterName = selectedCluster?.courts[0]?.name;

    const displayedError = locationError ?? courtsError;
    const needsManualSearch = cacheLoadFinished && locationStatus === 'denied' && courts.length === 0;

    function boundsFromRegion(region: Region) {
        return {
            south: region.latitude - region.latitudeDelta / 2,
            west: region.longitude - region.longitudeDelta / 2,
            north: region.latitude + region.latitudeDelta / 2,
            east: region.longitude + region.longitudeDelta / 2,
        };
    }

    const selectedCourtIds = new Set(
        selectedCluster?.courts.map((court) => court.id) ?? [],
    );

    const loadedVersionOfSelectedCluster = selectedCluster
        ? courtClusters.find((cluster) =>
            cluster.courts.some((court) =>          // check all cluster in this list and compare id to see if any cluster in here is equal to selected cluster
                selectedCourtIds.has(court.id),
            ),
        )
        : undefined;

    const displayedClusters =
        selectedCluster && !loadedVersionOfSelectedCluster
            ? [...courtClusters, selectedCluster] : courtClusters; 

    const focusedCluster = loadedVersionOfSelectedCluster ?? selectedCluster;

    useEffect(() => {
        if (!focusedCluster) return;

        mapRef.current?.animateToRegion({
            latitude: focusedCluster.latitude,
            longitude: focusedCluster.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
        }, 400);
    },[focusedCluster]);

    // give marker size based on how zoomed out/in the map currently is
    function markerSizeForRegion(region: Region) {
        const MAX_SIZE = 40;
        const MIN_SIZE = 16;
        const MIN_DELTA = 0.01;
        const HIDE_DELTA = 0.4;

        if (region.longitudeDelta >= HIDE_DELTA) {
            return 0;
        }

        const delta = Math.max(region.longitudeDelta, MIN_DELTA);

        const scale = Math.log(HIDE_DELTA / delta) / Math.log(HIDE_DELTA / MIN_DELTA);
        return Math.round(MIN_SIZE + scale * (MAX_SIZE - MIN_SIZE));
    }

    useEffect(() => {
        if (!cacheLoadFinished) return;
        if (locationStatus !== 'denied') return;
        if (courtClusters.length === 0) return;

        mapRef.current?.fitToCoordinates(
            courtClusters.map((cluster) => ({
                latitude: cluster.latitude,
                longitude: cluster.longitude,
            })),
            {
                edgePadding: {
                    top: 100,
                    right: 50,
                    bottom: 100,
                    left: 50,
                },
                animated: false,
            },
        );
    }, [cacheLoadFinished, locationStatus, courtClusters]);

    const enableLocation = useCallback(async () => {
        const { status } = await requestForegroundPermissionsAsync();
        if (status !== 'granted') {
            setLocationError('Permission to access location was denied');
            setLocationStatus('denied');
            return;
        }

        setLocationStatus('granted');
        setLocationError(null);
        setSelectedCluster(null);

        const location = await getCurrentPositionAsync({});

        const userRegion = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: NEARBY_REGION_DELTA,
            longitudeDelta: NEARBY_REGION_DELTA,
        };

        mapRef.current?.animateToRegion(userRegion, 400);
        await loadCourts(boundsFromRegion(userRegion));
    }, [loadCourts, setSelectedCluster]);

    useEffect(() => {
        if (!cacheLoadFinished) return;

        const timeout = setTimeout(() => {
            enableLocation().catch(() => {
                setLocationError('Unable to get your current location.');
                setLocationStatus('denied');
            });
        }, 0);

        return () => clearTimeout(timeout);
    }, [cacheLoadFinished, enableLocation]);

    return (
        <View style={styles.container}>
            <MapView
                style={styles.map}
                ref={mapRef}
                showsCompass
                showsUserLocation={(locationStatus === "granted")}
                showsPointsOfInterests={false}
                onRegionChangeComplete={(region) => {
                    setMarkerSize(markerSizeForRegion(region));
                }}
            >
                {markerSize > 0 && (
                    <CourtsMarker
                        clusters={displayedClusters}
                        markerSize={markerSize}
                        onSelect={setSelectedCluster}
                    />
                )}

            </MapView>
            <View
                style={[styles.searchLauncher, { top: controlsTop , backgroundColor: colors.surface}]}
            >
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Search courts"
                    onPress={() => router.push('/search')}
                    style={styles.searchLauncherButton}
                >
                    <Ionicons name="search" size={20} color={colors.icons} />
                    <Text style={styles.searchLauncherText} numberOfLines={1}>
                        {selectedClusterName ?? 'Search name or address'}
                    </Text>
                </Pressable>
                {selectedClusterName != null && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Clear search"
                        onPress={() => setSelectedCluster(null)}
                        style={styles.clearSearchButton}
                    >
                        <Ionicons name="close" size={22} color={colors.icons} />
                    </Pressable>
                )}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Account"
                    onPress={() => router.push('/account')}
                >
                    <Ionicons name="person-outline" style={[styles.accountIcon, {borderColor: colors.icons, backgroundColor:colors.border}]} size={22} color={colors.icons} />
                </Pressable>
            </View>

            {courtsLoading && (
                <Text style={[styles.info, { top: controlsTop + 58 }]}>Loading courts...</Text>
            )}
            {!courtsLoading && !displayedError && locationStatus === 'granted' && courts.length === 0 && (
                <Text style={[styles.info, { top: controlsTop + 58 }]}>No courts found nearby</Text>
            )}
            {needsManualSearch && (
                <View style={styles.locationFallback}>
                    <Text style={styles.locationFallbackTitle}>
                        Find courts without location
                    </Text>

                    <Text style={styles.locationFallbackMessage}>
                        Search for a court or enable location to find courts near you.
                    </Text>

                    <Pressable
                        style={styles.searchButton}
                        onPress={() => {
                            setSelectedCluster(null);   // clear so react zoom to cluster again if select the same one
                            router.push('/search')}
                        }
                    >
                        <Text style={styles.searchButtonText}>
                            Search manually
                        </Text>
                    </Pressable>

                    <Pressable onPress={enableLocation}>
                        <Text style={styles.retryText}>
                            Try location again
                        </Text>
                    </Pressable>
                </View>
            )}
            {displayedError && !needsManualSearch &&
                <Text style={[styles.error, { top: controlsTop + 58 }]}>{displayedError}</Text>
            }
            <Pressable
                style={styles.locationButton}
                onPress={() => {
                    enableLocation().catch(() => {
                    setLocationError('Unable to get your current location.');
                    });
                }}
            >
                <Ionicons name="locate" size={26} color="#ffffff" />
            </Pressable>
            
            <CourtDetailsSheet
                key={selectedCluster?.id ?? 'no-court-selected'}
                cluster={focusedCluster ?? null}
                onClose={() => setSelectedCluster(null)}
            />
        </View>
    );
}


const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        flexDirection: 'row',
    },
    map: { 
        width: '100%', 
        height: '100%' 
    },
    error: {
        fontSize: responsiveFontSize(14),
        position: 'absolute',
        alignSelf: 'center',
        backgroundColor: 'white',
        marginHorizontal: 16,
        padding: 10,
        borderRadius: 8,
        elevation: 3,
    },
    info: {
        fontSize: responsiveFontSize(14),
        position: 'absolute',
        alignSelf: 'center',
        backgroundColor: '#ffffff',
        color: '#172b4d',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
        elevation: 3,
    },
    locationButton: {
        position: 'absolute',
        right: 16,
        bottom: 40,
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#006eff',
        alignItems: 'center',
        justifyContent: 'center',
        elevation: 5,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 4,
    },
    locationIcon: {
        width: 26,
        height: 26,
    },
    locationFallback: {
        position: 'absolute',
        left: 24,
        right: 24,
        alignSelf: 'center',
        padding: 20,
        borderRadius: 16,
        backgroundColor: '#ffffff',
        elevation: 5,
    },
    locationFallbackTitle: {
        color: '#172b4d',
        fontSize: 18,
        fontWeight: '700',
        textAlign: 'center',
    },
    locationFallbackMessage: {
        marginTop: 8,
        color: '#52606d',
        fontSize: 14,
        textAlign: 'center',
    },
    searchButton: {
        marginTop: 18,
        paddingVertical: 12,
        borderRadius: 10,
        backgroundColor: '#006eff',
    },
    searchButtonText: {
        color: '#ffffff',
        fontWeight: '600',
        textAlign: 'center',
    },
    retryText: {
        marginTop: 14,
        color: '#006eff',
        fontWeight: '600',
        textAlign: 'center',
    },
    searchLauncher: {
        position: 'absolute',
        left: 16,
        right: 16,
        minHeight: 48,
        paddingHorizontal: 14,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        elevation: 5,
        shadowColor: '#000000',
        shadowOpacity: 0.18,
        shadowRadius: 6,
        shadowOffset: {
            width: 0,
            height: 2,
        },
    },
    searchLauncherButton: {
        flex: 1,
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
    },
    clearSearchButton: {
        width: 44,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    searchLauncherText: {
        flex: 1,
        marginLeft: 10,
        color: '#52606d',
        fontSize: responsiveFontSize(16),
    },
    accountIcon: {
        borderWidth: 2, 
        borderRadius: 22, 
        padding: 5,
    }
});
