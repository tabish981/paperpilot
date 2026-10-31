import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DarkTheme } from '../theme/colors';
import { useAppStore } from '../store/useAppStore';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export const Header: React.FC<HeaderProps> = ({ title, subtitle }) => {
  const serverConnected = useAppStore((state) => state.serverConnected);

  return (
    <View style={styles.container}>
      <View>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      <View style={styles.serverStatus}>
        <View
          style={[
            styles.dot,
            { backgroundColor: serverConnected ? DarkTheme.success : DarkTheme.error },
          ]}
        />
        <Text style={styles.serverText}>
          {serverConnected ? 'Termux: Online' : 'Termux: Offline'}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: DarkTheme.background,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: DarkTheme.border,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: DarkTheme.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 12,
    color: DarkTheme.textSecondary,
    marginTop: 2,
  },
  serverStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DarkTheme.surfaceVariant,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: DarkTheme.border,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  serverText: {
    fontSize: 11,
    fontWeight: '600',
    color: DarkTheme.textSecondary,
  },
});
