import { Image, View, Text, StyleSheet} from 'react-native';
import { Marker } from 'react-native-maps';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { CourtCluster } from '@/type/CourtCluster';
import { useAppTheme } from '@/theme/appTheme';

type CourtsMarkerProps = {
    clusters: CourtCluster[];
    markerSize: number;
    onSelect: (cluster: CourtCluster) => void;
};

function clusterTitle(cluster: CourtCluster) {
    const namedCourts = [...new Set(
        cluster.courts.map((court) => court.name).filter((name) => name !== 'Unnamed court'),
    )];
    return namedCourts[0] ?? `${cluster.courts.length} nearby courts`;
}

export default function CourtsMarker({ clusters, markerSize, onSelect }: CourtsMarkerProps) {
    const { colors } = useAppTheme();
    const clusterMarkerSize = markerSize + 8;
    return (
        <>
        {clusters.map((cluster) => {
            // new set of sports for each cluster since courts can be used for many sports
            const isCluster = cluster.courts.length > 1;
            const size = isCluster ? clusterMarkerSize : markerSize;
            const uniqueSports = [...new Set(cluster.courts.map((court) => court.sport))];
            const sport = cluster.courts[0]?.sport;
            const sportImage = sport === 'badminton'
                ? require('@/assets/icons/shuttlecock.png')
                : sport === 'pickleball'
                    ? require('@/assets/icons/pickleball.png')
                    : null;
            const iconSize = size * 0.58;
            const sports = uniqueSports.join(', ');
            const address = cluster.courts.find((court) => court.address)?.address ?? 'Address unavailable';
            const details = [
                cluster.courts.length > 1 ? `${cluster.courts.length} courts` : undefined,
                sports,
                address,
            ].filter(Boolean).join(' · ');

            return (
            <Marker
                key={cluster.id}
                accessibilityLabel={`${clusterTitle(cluster)}. ${details}`}
                coordinate={{
                    latitude: cluster.latitude,
                    longitude: cluster.longitude,
                }}
                onPress={(event) => {
                    event.stopPropagation();
                    onSelect(cluster);
                }}
            >
                <View style={[styles.marker, isCluster && styles.clusterMarker, 
                    {
                        width: size,
                        height: size,
                        borderRadius: size /2,
                    }]}
                >
                    {sportImage ? (
                        <Image
                            source={sportImage}
                            style={{ width: iconSize, height: iconSize }}
                            resizeMode="contain"
                            fadeDuration={0}
                        />
                    ) : sport === 'tennis' ? (
                        <Ionicons name="tennisball" size={iconSize} color='#000000' />
                    ) : isCluster ? (
                        <Text style={[styles.markerText, {fontSize: markerSize * 0.44}]}
                        >
                            {cluster.courts.length}
                        </Text>
                    ) : (
                        <Ionicons name="location" size={iconSize} color={colors.icons} />
                    )}
                </View>
            </Marker>
            );
        })}
        </>
    )
}

const styles = StyleSheet.create({
    marker: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#14B8A6',
        borderColor: '#ffffff',
        borderWidth: 2,
    },
    clusterMarker: {
        backgroundColor: '#0D9488',
    },
    markerText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '700',
    },
});
