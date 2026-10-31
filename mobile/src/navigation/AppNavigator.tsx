import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer } from '@react-navigation/native';
import { Text, View, StyleSheet } from 'react-native';
import { DarkTheme } from '../theme/colors';

import { HomeScreen } from '../screens/HomeScreen';
import { DocumentsScreen } from '../screens/DocumentsScreen';
import { QueueScreen } from '../screens/QueueScreen';
import { PrintersScreen } from '../screens/PrintersScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { WifiDirectScreen } from '../screens/WifiDirectScreen';

// ------------ Type Declarations ------------
export type RootStackParamList = {
  MainTabs: undefined;
  WifiDirect: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Docs: undefined;
  Queue: undefined;
  Printers: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

// ------------ Tab Icon Component ------------
function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const getSymbol = () => {
    switch (label) {
      case 'Home':
        return '⌂';
      case 'Docs':
        return '📄';
      case 'Queue':
        return '☰';
      case 'Printers':
        return '🖨';
      case 'Settings':
        return '⚙';
      default:
        return '•';
    }
  };

  return (
    <View style={styles.iconContainer}>
      <Text style={[styles.symbol, { color: focused ? DarkTheme.primary : DarkTheme.textMuted }]}>
        {getSymbol()}
      </Text>
    </View>
  );
}

// ------------ Bottom Tab Navigator ------------
function MainTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: DarkTheme.surface,
          borderTopColor: DarkTheme.border,
          borderTopWidth: 1,
          height: 62,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: DarkTheme.primary,
        tabBarInactiveTintColor: DarkTheme.textMuted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
        },
        tabBarIcon: ({ focused }) => <TabIcon label={route.name} focused={focused} />,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Docs" component={DocumentsScreen} />
      <Tab.Screen name="Queue" component={QueueScreen} />
      <Tab.Screen name="Printers" component={PrintersScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

// ------------ Root Stack Navigator ------------
export const AppNavigator: React.FC = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_bottom',
          contentStyle: { backgroundColor: DarkTheme.background },
        }}
      >
        <Stack.Screen name="MainTabs" component={MainTabNavigator} />
        <Stack.Screen
          name="WifiDirect"
          component={WifiDirectScreen}
          options={{
            headerShown: true,
            headerTitle: 'Wi-Fi Direct Setup',
            headerStyle: { backgroundColor: DarkTheme.surface },
            headerTintColor: DarkTheme.text,
            headerTitleStyle: { fontWeight: '700' },
            animation: 'slide_from_right',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbol: {
    fontSize: 18,
  },
});
