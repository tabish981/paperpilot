import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DarkTheme } from '../theme/colors';

interface StatusBadgeProps {
  status: string;
  label?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
  const getColors = () => {
    switch (status.toUpperCase()) {
      case 'AVAILABLE':
      case 'COMPLETED':
        return { bg: DarkTheme.successContainer, text: DarkTheme.success, border: DarkTheme.success };
      case 'PRINTING':
      case 'SUBMITTED':
        return { bg: DarkTheme.primaryContainer, text: DarkTheme.primary, border: DarkTheme.primary };
      case 'WAITING_FOR_PRINTER':
      case 'PENDING':
        return { bg: DarkTheme.surfaceVariant, text: DarkTheme.textSecondary, border: DarkTheme.border };
      case 'NEEDS_CONFIRMATION':
      case 'INTERRUPTED':
      case 'PAUSED':
        return { bg: DarkTheme.accentContainer, text: DarkTheme.accent, border: DarkTheme.accent };
      case 'DISCONNECTED':
      case 'FAILED':
      case 'ERROR':
        return { bg: DarkTheme.errorContainer, text: DarkTheme.error, border: DarkTheme.error };
      default:
        return { bg: DarkTheme.surfaceVariant, text: DarkTheme.textMuted, border: DarkTheme.border };
    }
  };

  const { bg, text, border } = getColors();

  return (
    <View style={[styles.badge, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[styles.text, { color: text }]}>{label || status}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
