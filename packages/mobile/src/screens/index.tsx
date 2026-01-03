// Placeholder screens - to be implemented
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Import Wallet Screen
export function ImportWalletScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backButtonText}>←</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Import Wallet</Text>
      <Text style={styles.subtitle}>TODO: Implement import from seed phrase or private key</Text>
    </SafeAreaView>
  );
}

// Main Screen (Wallet Dashboard)
export function MainScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>X1 Wallet</Text>
      <Text style={styles.balance}>0 XNT</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('Send')}>
          <Text style={styles.actionText}>Send</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('Receive')}>
          <Text style={styles.actionText}>Receive</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('Swap')}>
          <Text style={styles.actionText}>Swap</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// Send Screen
export function SendScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backButtonText}>←</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Send</Text>
      <Text style={styles.subtitle}>TODO: Implement send functionality</Text>
    </SafeAreaView>
  );
}

// Receive Screen
export function ReceiveScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backButtonText}>←</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Receive</Text>
      <Text style={styles.subtitle}>TODO: Show QR code and address</Text>
    </SafeAreaView>
  );
}

// Swap Screen  
export function SwapScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backButtonText}>←</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Swap</Text>
      <Text style={styles.subtitle}>TODO: Implement XDEX swap using @x1-wallet/core</Text>
    </SafeAreaView>
  );
}

// Settings Screen
export function SettingsScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backButtonText}>←</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.subtitle}>TODO: Implement settings</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    padding: 24,
  },
  backButton: {
    marginBottom: 24,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
  },
  balance: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginVertical: 48,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  actionButton: {
    backgroundColor: '#0274fb',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  actionText: {
    color: '#fff',
    fontWeight: '600',
  },
});

export default {
  ImportWalletScreen,
  MainScreen,
  SendScreen,
  ReceiveScreen,
  SwapScreen,
  SettingsScreen,
};
