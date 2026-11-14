import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import {CatalogProvider} from '../data/CatalogContext';
export default function Layout() { return <SafeAreaProvider initialMetrics={initialWindowMetrics}><CatalogProvider><StatusBar style='dark' /><Stack screenOptions={{headerShown:false}} /></CatalogProvider></SafeAreaProvider>; }
