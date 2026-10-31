import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './navigation/AppNavigator';
import { useSocketTelemetry } from './hooks/useSocketTelemetry';

/**
 * PaperPilot – App Root Component
 *
 * Initializes the socket telemetry hook which handles:
 *  - Persistent WebSocket to Termux backend via loopback
 *  - Native notification channel for print progress
 *  - Zustand store data sync (queue, printers, health)
 *  - Duplex confirmation alerts
 *  - Job completion/failure toasts
 */
function AppInner() {
  // Hook into the persistent socket telemetry system
  useSocketTelemetry('http://127.0.0.1:5000');

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#0B0F14" />
      <AppNavigator />
    </>
  );
}

export const App: React.FC = () => {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
};

export default App;
