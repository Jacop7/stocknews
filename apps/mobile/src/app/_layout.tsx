import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import {CatalogProvider} from '../data/CatalogContext';
import {BookmarksProvider} from '../data/BookmarksContext';
export default function Layout() { return <SafeAreaProvider initialMetrics={initialWindowMetrics}><BookmarksProvider><CatalogProvider><StatusBar style='dark' /><Stack screenOptions={{headerShown:false}} /></CatalogProvider></BookmarksProvider></SafeAreaProvider>; }
