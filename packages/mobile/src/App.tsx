// X1 Wallet Mobile - React Native Entry Point
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Screens
import WelcomeScreen from './screens/WelcomeScreen';
import CreateWalletScreen from './screens/CreateWalletScreen';
import {
  ImportWalletScreen,
  MainScreen,
  SendScreen,
  ReceiveScreen,
  SwapScreen,
  SettingsScreen,
} from './screens';

const Stack = createStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator 
          initialRouteName="Welcome"
          screenOptions={{
            headerShown: false,
            cardStyle: { backgroundColor: '#000' }
          }}
        >
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="CreateWallet" component={CreateWalletScreen} />
          <Stack.Screen name="ImportWallet" component={ImportWalletScreen} />
          <Stack.Screen name="Main" component={MainScreen} />
          <Stack.Screen name="Send" component={SendScreen} />
          <Stack.Screen name="Receive" component={ReceiveScreen} />
          <Stack.Screen name="Swap" component={SwapScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
