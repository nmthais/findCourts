import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useAppTheme } from '@/theme/appTheme';

// Place inside a SafeAreaView, so only the extra four-point gap is needed.
export default function AccountBackButton({ disabled = false }: { disabled?: boolean }) {
  const { colors } = useAppTheme();

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="Go back"
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={10}
        onPress={goBack}
        style={({ pressed }) => [styles.button, {
          backgroundColor: pressed ? colors.pressed : 'transparent',
          opacity: disabled ? 0.5 : 1,
        }]}
      >
        <Ionicons name="arrow-back" size={22} color={colors.icons} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 4,
    paddingHorizontal: 16,
  },
  button: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
