import { Ionicons } from '@expo/vector-icons';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors } from '../../theme/colors';
import { radii } from '../../theme/radii';
import { layoutSpacing } from '../../theme/spacing';
import { textPresets } from '../../theme/typography';

export interface SearchFieldProps extends Omit<TextInputProps, 'style'> {
  containerStyle?: StyleProp<ViewStyle>;
}

/** 44h search field matching pen S3. */
export function SearchField({ containerStyle, ...inputProps }: SearchFieldProps) {
  return (
    <View style={[styles.container, containerStyle]}>
      <Ionicons name="search" size={19} color={colors.textMuted} />
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.textSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        {...inputProps}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 44,
    marginHorizontal: layoutSpacing.pageHorizontal,
    backgroundColor: colors.surface1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.lineDefault,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    ...textPresets.body,
    color: colors.textStrong,
    padding: 0,
  },
});
