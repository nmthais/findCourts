import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@/context/AuthContext';
import { useAppTheme } from '@/theme/appTheme';
import {
  deleteCourtImage,
  getCourtImages,
  requestUploadSignature,
  saveCourtImage,
  uploadToCloudinary,
  type CourtImage,
} from '@/services/courtImages';

type Props = {
  courtId: string;
  mode: 'preview' | 'gallery';
  onSeeAll?: () => void;
};

export type CourtPhotosHandle = {
  loadMore: () => void;
};

const PAGE_SIZE = 20;
const MAX_VISIBLE_IMAGES = 50;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const CourtPhotos = forwardRef<CourtPhotosHandle, Props>(function CourtPhotos(
  { courtId, mode, onSeeAll },
  ref,
) {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const { user } = useAuth();
  const [images, setImages] = useState<CourtImage[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<CourtImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadMorePending = useRef(false);
  const previewPhotoWidth = Math.min(screenWidth - 64, 420);
  const galleryPhotoWidth = Math.max(130, (screenWidth - 50) / 2);

  useEffect(() => {
    let cancelled = false;
    const loadingTimer = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    }, 0);
    getCourtImages(courtId, user, PAGE_SIZE, 0).then((page) => {
      if (cancelled) return;
      setImages(page.images);
      setTotalCount(page.count);
    }).catch((loadError) => {
      if (!cancelled) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load court photos.');
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
      clearTimeout(loadingTimer);
    };
  }, [courtId, user]);

  const loadMore = useCallback(async () => {
    if (
      mode !== 'gallery'
      || loading
      || loadMorePending.current
      || images.length >= Math.min(totalCount, MAX_VISIBLE_IMAGES)
    ) return;

    // A ref blocks repeated scroll callbacks immediately, before loading state re-renders.
    loadMorePending.current = true;
    setLoadingMore(true);
    try {
      const page = await getCourtImages(courtId, user, PAGE_SIZE, images.length);
      setImages((current) => {
        // New uploads can shift offset-based pages, so overlapping results must be deduplicated.
        const knownIds = new Set(current.map((image) => image.id));
        return [...current, ...page.images.filter((image) => !knownIds.has(image.id))];
      });
      setTotalCount(page.count);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load more photos.');
    } finally {
      loadMorePending.current = false;
      setLoadingMore(false);
    }
  }, [courtId, images.length, loading, mode, totalCount, user]);

  useImperativeHandle(ref, () => ({
    loadMore: () => { loadMore().catch(() => {}); },
  }), [loadMore]);

  async function addPhoto() {
    if (!user) {
      router.push('/login');
      return;
    }
    if (uploading) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo-library permission is required to add a court photo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 5,
      orderedSelection: true,
      quality: 0.85,
    });
    if (result.canceled) return;

    const oversizedAsset = result.assets.find(
      (asset) => asset.fileSize && asset.fileSize > MAX_UPLOAD_BYTES,
    );
    if (oversizedAsset) {
      setError('Each selected photo must be smaller than 10 MB.');
      return;
    }

    setUploading(true);
    setError(null);
    const savedImages: CourtImage[] = [];
    try {
      for (const asset of result.assets) {
        // Save each upload before starting the next; a later failure preserves earlier successes.
        const signature = await requestUploadSignature(user, courtId);
        const uploaded = await uploadToCloudinary(asset, signature);
        const saved = await saveCourtImage(user, courtId, uploaded.publicId);
        savedImages.push(saved);
        setImages((current) => [
          saved,
          ...current.filter((image) => image.id !== saved.id),
        ].slice(0, MAX_VISIBLE_IMAGES));
        setTotalCount((count) => count + 1);
      }
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Unable to upload the photos.';
      setError(savedImages.length > 0
        ? `${savedImages.length} photo${savedImages.length === 1 ? '' : 's'} uploaded. ${message}`
        : message);
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(image: CourtImage) {
    if (!user || deletingId) return;
    setDeletingId(image.id);
    setError(null);
    try {
      await deleteCourtImage(user, image.id);
      setImages((current) => current.filter((item) => item.id !== image.id));
      setTotalCount((count) => Math.max(0, count - 1));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete the photo.');
    } finally {
      setDeletingId(null);
    }
  }

  function confirmDelete(image: CourtImage) {
    Alert.alert('Delete photo?', 'This removes the photo permanently.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => { removePhoto(image).catch(() => {}); },
      },
    ]);
  }

  const displayedImages = mode === 'preview' ? images.slice(0, 4) : images;
  const myImages = images.filter((image) => image.is_mine);

  function photoCard(
    image: CourtImage,
    width: number,
    height: number,
    showDelete = false,
  ) {
    return (
    <View key={image.id} style={styles.photoContainer}>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel="Open court photo full screen"
        onPress={() => setSelectedImage(image)}
      >
        <Image
          source={{ uri: image.cloudinary_secure_url }}
          style={[
            styles.photo,
            { width, height },
          ]}
          contentFit="cover"
          transition={150}
        />
      </Pressable>
      {showDelete && image.is_mine && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete your court photo"
          onPress={() => confirmDelete(image)}
          disabled={deletingId !== null}
          style={[styles.deleteButton, { backgroundColor: colors.surface }]}
        >
          {deletingId === image.id
            ? <ActivityIndicator size="small" color={colors.error} />
            : <Ionicons name="trash-outline" size={18} color={colors.error} />}
        </Pressable>
      )}
    </View>
    );
  }

  return (
    <View>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: colors.text }]}>Photos</Text>
        {mode === 'preview' ? (
          <Pressable onPress={onSeeAll} hitSlop={8}>
            <Text style={{ color: colors.primary }}>See all</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => { addPhoto().catch(() => {}); }}
            disabled={uploading}
            style={[styles.addButton, { backgroundColor: colors.button, opacity: uploading ? 0.6 : 1 }]}
          >
            {uploading
              ? <ActivityIndicator size="small" color={colors.buttonText} />
              : <Ionicons name="add" size={18} color={colors.buttonText} />}
            <Text style={[styles.addButtonText, { color: colors.buttonText }]}>Add photos</Text>
          </Pressable>
        )}
      </View>

      {error && (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{error}</Text>
      )}

      {loading ? (
        <ActivityIndicator style={styles.loader} color={colors.button} />
      ) : displayedImages.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: colors.pressed }]}>
          <Ionicons name="images-outline" size={36} color={colors.icons} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No court photos yet</Text>
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>Be the first to add one.</Text>
          {mode === 'preview' && (
            <Pressable onPress={() => { addPhoto().catch(() => {}); }} disabled={uploading}>
              <Text style={[styles.emptyAction, { color: colors.primary }]}>Add photos</Text>
            </Pressable>
          )}
        </View>
      ) : mode === 'preview' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photoRow}
        >
          {displayedImages.map((image) => photoCard(image, previewPhotoWidth, 190))}
        </ScrollView>
      ) : (
        <>
          {myImages.length > 0 && (
            <View style={styles.myPhotosSection}>
              <Text style={[styles.subsectionTitle, { color: colors.text }]}>My photos</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.photoRow}
              >
                {myImages.map((image) => photoCard(image, 190, 140, true))}
              </ScrollView>
            </View>
          )}
          <View style={styles.galleryHeading}>
            <Text style={[styles.subsectionTitle, { color: colors.text }]}>Court gallery</Text>
            <Text style={[styles.galleryCount, { color: colors.secondaryText }]}>
              {Math.min(totalCount, MAX_VISIBLE_IMAGES)} photos
            </Text>
          </View>
          <View style={styles.photoGrid}>
            {images.map((image) => photoCard(image, galleryPhotoWidth, 150))}
          </View>
          {loadingMore && <ActivityIndicator style={styles.loadingMore} color={colors.button} />}
        </>
      )}

      {mode === 'gallery' && totalCount > MAX_VISIBLE_IMAGES && images.length >= MAX_VISIBLE_IMAGES && (
        <Text style={[styles.limitText, { color: colors.secondaryText }]}>Showing the latest 50 photos.</Text>
      )}

      <Modal
        visible={selectedImage !== null}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={() => setSelectedImage(null)}
      >
        <SafeAreaView style={styles.viewer}>
          {selectedImage && (
            <Image
              source={{ uri: selectedImage.cloudinary_secure_url }}
              style={styles.viewerImage}
              contentFit="contain"
              transition={150}
            />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close full-screen photo"
            hitSlop={10}
            onPress={() => setSelectedImage(null)}
            style={[styles.viewerClose, { top: insets.top + 12 }]}
          >
            <Ionicons name="close" size={28} color="#ffffff" />
          </Pressable>
        </SafeAreaView>
      </Modal>
    </View>
  );
});

export default CourtPhotos;

const styles = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  addButton: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  error: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 20,
  },
  loader: {
    marginVertical: 42,
  },
  empty: {
    minHeight: 150,
    marginTop: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emptyTitle: {
    marginTop: 9,
    fontSize: 16,
    fontWeight: '700',
  },
  emptyText: {
    marginTop: 4,
    fontSize: 14,
  },
  emptyAction: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  photoRow: {
    gap: 10,
    paddingTop: 14,
    paddingRight: 4,
  },
  myPhotosSection: {
    marginTop: 20,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  galleryHeading: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  galleryCount: {
    fontSize: 13,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingTop: 14,
  },
  photoContainer: {
    position: 'relative',
  },
  photo: {
    borderRadius: 12,
  },
  deleteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  loadingMore: {
    marginVertical: 20,
  },
  limitText: {
    marginTop: 10,
    fontSize: 12,
    textAlign: 'center',
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
