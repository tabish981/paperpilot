import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { DarkTheme } from '../theme/colors';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: 'surface' | 'surfaceVariant' | 'highlight';
}

export const Card: React.FC<CardProps> = ({ children, style, variant = 'surface' }) => {
  const getBgColor = () => {
    switch (variant) {
      case 'surfaceVariant':
        return DarkTheme.surfaceVariant;
      case 'highlight':
        return DarkTheme.surfaceHover;
      default:
        return DarkTheme.surface;
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: getBgColor() }, style]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: DarkTheme.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
});
