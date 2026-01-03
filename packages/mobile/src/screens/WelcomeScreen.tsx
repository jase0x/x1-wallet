// X1 Wallet Mobile - Welcome Screen
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Shared core - same imports as extension!
import { NETWORKS } from '@x1-wallet/core/services/networks';

export default function WelcomeScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* X1 Logo */}
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>X1</Text>
        </View>
        
        <Text style={styles.title}>X1 Wallet</Text>
        <Text style={styles.tagline}>Designed for the Chains That Win</Text>
        
        <View style={styles.buttons}>
          <TouchableOpacity 
            style={styles.primaryButton}
            onPress={() => navigation.navigate('CreateWallet')}
          >
            <Text style={styles.primaryButtonText}>Create New Wallet</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.secondaryButton}
            onPress={() => navigation.navigate('ImportWallet')}
          >
            <Text style={styles.secondaryButtonText}>Import Existing Wallet</Text>
          </TouchableOpacity>
        </View>
      </View>
      
      <Text style={styles.footer}>Powered by X1 Blockchain</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: '#0274fb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  logoText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    color: '#888',
    marginBottom: 48,
  },
  buttons: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#0274fb',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    color: '#0274fb',
    fontSize: 12,
    textAlign: 'center',
    paddingBottom: 24,
  },
});
