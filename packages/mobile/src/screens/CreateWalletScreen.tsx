// X1 Wallet Mobile - Create Wallet Screen
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Shared core - same crypto as extension!
import { generateMnemonic, validateMnemonic } from '@x1-wallet/core/utils/bip39';
import { deriveKeypair } from '@x1-wallet/core/utils/bip44';

export default function CreateWalletScreen({ navigation }) {
  const [step, setStep] = useState('choose'); // choose, generate, verify, name
  const [mnemonic, setMnemonic] = useState('');
  const [walletName, setWalletName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const newMnemonic = await generateMnemonic(128); // 12 words
      setMnemonic(newMnemonic);
      setStep('generate');
    } catch (err) {
      console.error('Failed to generate mnemonic:', err);
    }
    setLoading(false);
  };

  const handleComplete = async () => {
    // Derive keypair from mnemonic using shared core
    const keypair = await deriveKeypair(mnemonic, 0);
    
    // TODO: Save to secure storage (react-native-keychain)
    console.log('Wallet created:', keypair.publicKey);
    
    navigation.replace('Main');
  };

  if (step === 'choose') {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        
        <Text style={styles.title}>Create New Wallet</Text>
        <Text style={styles.subtitle}>Choose how to create your recovery phrase</Text>
        
        <TouchableOpacity style={styles.optionButton} onPress={handleGenerate}>
          {loading ? (
            <ActivityIndicator color="#0274fb" />
          ) : (
            <>
              <Text style={styles.optionTitle}>Generate Random Phrase</Text>
              <Text style={styles.optionDesc}>Cryptographically secure (recommended)</Text>
            </>
          )}
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (step === 'generate') {
    const words = mnemonic.split(' ');
    
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={() => setStep('choose')}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        
        <Text style={styles.title}>Your Recovery Phrase</Text>
        <Text style={styles.subtitle}>Write down these words in order</Text>
        
        <ScrollView style={styles.seedContainer}>
          <View style={styles.seedGrid}>
            {words.map((word, i) => (
              <View key={i} style={styles.seedWord}>
                <Text style={styles.seedNumber}>{i + 1}</Text>
                <Text style={styles.seedText}>{word}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
        
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            ⚠️ Never share your recovery phrase. Anyone with these words can access your funds.
          </Text>
        </View>
        
        <TouchableOpacity 
          style={styles.primaryButton}
          onPress={() => setStep('name')}
        >
          <Text style={styles.primaryButtonText}>I've Written It Down</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (step === 'name') {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={() => setStep('generate')}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        
        <Text style={styles.title}>Name Your Wallet</Text>
        <Text style={styles.subtitle}>Give your wallet a name to identify it</Text>
        
        <TextInput
          style={styles.input}
          placeholder="My Wallet"
          placeholderTextColor="#666"
          value={walletName}
          onChangeText={setWalletName}
        />
        
        <TouchableOpacity 
          style={styles.primaryButton}
          onPress={handleComplete}
        >
          <Text style={styles.primaryButtonText}>Create Wallet</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return null;
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
    marginBottom: 32,
  },
  optionButton: {
    backgroundColor: '#111',
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222',
  },
  optionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  optionDesc: {
    color: '#888',
    fontSize: 13,
  },
  seedContainer: {
    flex: 1,
  },
  seedGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  seedWord: {
    width: '30%',
    backgroundColor: '#111',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  seedNumber: {
    color: '#0274fb',
    fontSize: 12,
    fontWeight: '600',
  },
  seedText: {
    color: '#fff',
    fontSize: 14,
  },
  warning: {
    backgroundColor: 'rgba(255, 165, 2, 0.1)',
    padding: 16,
    borderRadius: 12,
    marginVertical: 16,
  },
  warningText: {
    color: '#ffa502',
    fontSize: 13,
    textAlign: 'center',
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
  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    marginBottom: 24,
  },
});
