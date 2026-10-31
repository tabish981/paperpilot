/**
 * Material Design 3 Curated Color Palette for PaperPilot
 */

export const DarkTheme = {
  background: '#0B0F14',
  surface: '#121720',
  surfaceVariant: '#1A2230',
  surfaceHover: '#222D3E',
  border: '#273448',
  primary: '#00D2C4', // Vibrant Cyan / Modern Printer Ink Blue
  primaryContainer: '#003834',
  onPrimary: '#00201D',
  secondary: '#6366F1', // Electric Indigo
  secondaryContainer: '#222557',
  accent: '#F59E0B', // Amber for checkpoints & warnings
  accentContainer: '#3B2600',
  success: '#10B981', // Emerald for completed sheets
  successContainer: '#042F20',
  error: '#EF4444', // Crimson for errors / interruptions
  errorContainer: '#380D0D',
  text: '#F3F4F6',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
};

export const LightTheme = {
  background: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceVariant: '#EDF2F7',
  surfaceHover: '#E2E8F0',
  border: '#CBD5E1',
  primary: '#0D9488',
  primaryContainer: '#CCFBF1',
  onPrimary: '#FFFFFF',
  secondary: '#4F46E5',
  secondaryContainer: '#E0E7FF',
  accent: '#D97706',
  accentContainer: '#FEF3C7',
  success: '#059669',
  successContainer: '#D1FAE5',
  error: '#DC2626',
  errorContainer: '#FEE2E2',
  text: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
};

export type ThemeColors = typeof DarkTheme;
