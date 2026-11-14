import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
export default function Layout() { return <SafeAreaProvider initialMetrics={initialWindowMetrics}><StatusBar style='dark' /><Stack screenOptions={{headerShown:false}} /></SafeAreaProvider>; }
