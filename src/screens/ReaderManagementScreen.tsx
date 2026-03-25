import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { useTheme } from '../context/ThemeContext';
import { useTerminal, classifyReaderType } from '../context/StripeTerminalContext';
import type { PreferredReader } from '../context/StripeTerminalContext';
import { stripeTerminalApi, TerminalReader } from '../lib/api/stripe-terminal';
import { fonts } from '../lib/fonts';
import { glass } from '../lib/colors';

export function ReaderManagementScreen() {
  const { colors, isDark } = useTheme();
  const glassColors = isDark ? glass.dark : glass.light;
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const {
    isConnected,
    connectedReaderType,
    connectedReaderLabel,
    bluetoothReaders,
    isScanning,
    disconnectReader,
    scanForBluetoothReaders,
    connectReader,
    preferredReader,
    setPreferredReader,
    clearPreferredReader,
  } = useTerminal();

  const [showRegister, setShowRegister] = useState(false);
  const [registrationCode, setRegistrationCode] = useState('');
  const [readerLabel, setReaderLabel] = useState('');
  const [connectingSerial, setConnectingSerial] = useState<string | null>(null);

  // Fetch registered readers
  const { data: readersData, isLoading, refetch } = useQuery({
    queryKey: ['terminal-readers'],
    queryFn: async () => {
      const result = await stripeTerminalApi.listReaders();
      return result.readers;
    },
  });

  const readers = readersData || [];

  // Register reader mutation
  const registerMutation = useMutation({
    mutationFn: (data: { registrationCode: string; label?: string }) =>
      stripeTerminalApi.registerReader(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminal-readers'] });
      setShowRegister(false);
      setRegistrationCode('');
      setReaderLabel('');
      Alert.alert('Reader Registered', 'The terminal reader has been registered successfully.');
    },
    onError: (error: any) => {
      Alert.alert('Registration Failed', error.message || 'Failed to register reader. Check the registration code and try again.');
    },
  });

  // Delete reader mutation
  const deleteMutation = useMutation({
    mutationFn: (readerId: string) => stripeTerminalApi.deleteReader(readerId),
    onSuccess: (_data, readerId) => {
      queryClient.invalidateQueries({ queryKey: ['terminal-readers'] });
      // If the deleted reader was the preferred reader, clear it
      if (preferredReader?.id === readerId) {
        clearPreferredReader();
      }
    },
    onError: (error: any) => {
      Alert.alert('Delete Failed', error.message || 'Failed to delete reader.');
    },
  });

  const handleRegister = useCallback(() => {
    if (!registrationCode.trim()) {
      Alert.alert('Missing Code', 'Please enter the registration code from the reader.');
      return;
    }
    registerMutation.mutate({
      registrationCode: registrationCode.trim(),
      label: readerLabel.trim() || undefined,
    });
  }, [registrationCode, readerLabel, registerMutation]);

  const handleReaderAction = useCallback((reader: TerminalReader) => {
    const isDefault = preferredReader?.id === reader.id;
    const readerType = classifyReaderType(reader.deviceType);

    Alert.alert(
      reader.label || reader.deviceType,
      isDefault ? 'This is your default reader.' : `${reader.status || 'Unknown status'}`,
      [
        {
          text: isDefault ? 'Clear Default' : 'Set as Default',
          onPress: () => {
            if (isDefault) {
              clearPreferredReader();
            } else {
              setPreferredReader({
                id: reader.id,
                label: reader.label,
                deviceType: reader.deviceType,
                readerType,
              });
            }
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMutation.mutate(reader.id),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, [preferredReader, setPreferredReader, clearPreferredReader, deleteMutation]);

  const handleBluetoothScan = useCallback(async () => {
    try {
      const found = await scanForBluetoothReaders();
      if (found.length === 0) {
        Alert.alert(
          'No Readers Found',
          'Make sure your Bluetooth reader is powered on, in pairing mode, and within a few feet of your phone. Then try again.',
        );
      }
    } catch (err: any) {
      const message = err.message || 'Failed to scan for Bluetooth readers.';
      Alert.alert('Scan Failed', message);
    }
  }, [scanForBluetoothReaders]);

  const handleConnectBluetooth = useCallback(async (reader: any) => {
    const serial = reader.serialNumber || reader.id;
    setConnectingSerial(serial);
    try {
      await connectReader('bluetoothScan', reader);
      await setPreferredReader({
        id: serial,
        label: reader.label || reader.serialNumber || 'Bluetooth Reader',
        deviceType: reader.deviceType || 'bluetooth',
        readerType: 'bluetooth',
      });
    } catch (err: any) {
      Alert.alert('Connection Failed', err.message || 'Could not connect to the Bluetooth reader. Make sure it is powered on and nearby.');
    } finally {
      setConnectingSerial(null);
    }
  }, [connectReader, setPreferredReader]);

  const handleDisconnect = useCallback(async () => {
    await disconnectReader();
  }, [disconnectReader]);

  const handleClearDefault = useCallback(() => {
    Alert.alert(
      'Clear Default Reader',
      'This will revert to using Tap to Pay for all payments.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => clearPreferredReader(),
        },
      ]
    );
  }, [clearPreferredReader]);

  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: insets.top + 8,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: cardBorder,
      backgroundColor: colors.background,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
    },
    headerTitle: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    headerRight: {
      marginLeft: 'auto',
    },
    content: {
      flex: 1,
    },
    section: {
      marginTop: 24,
      marginHorizontal: 16,
    },
    sectionTitle: {
      fontSize: 13,
      fontFamily: fonts.semiBold,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 8,
      paddingHorizontal: 4,
    },
    card: {
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: cardBorder,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    rowLeft: {
      flex: 1,
    },
    readerName: {
      fontSize: 16,
      fontFamily: fonts.medium,
      color: colors.text,
    },
    readerDetail: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      marginTop: 2,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginRight: 8,
    },
    divider: {
      height: 1,
      backgroundColor: cardBorder,
      marginLeft: 16,
    },
    emptyState: {
      alignItems: 'center',
      paddingVertical: 32,
      paddingHorizontal: 24,
    },
    emptyText: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: 12,
    },
    registerForm: {
      padding: 16,
    },
    input: {
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: cardBorder,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.text,
      marginBottom: 12,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 4,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    primaryButtonText: {
      fontSize: 15,
      fontFamily: fonts.semiBold,
      color: '#FFFFFF',
    },
    secondaryButton: {
      flex: 1,
      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    secondaryButtonText: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    actionButtonText: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: colors.primary,
    },
    defaultBadge: {
      backgroundColor: colors.primary + '20',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      marginLeft: 8,
    },
    defaultBadgeText: {
      fontSize: 11,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    defaultInfoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    defaultInfoLabel: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
    },
    defaultInfoValue: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.text,
      flex: 1,
      marginLeft: 8,
    },
    clearButton: {
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    clearButtonText: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.error,
    },
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>Terminal Readers</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => setShowRegister(!showRegister)}
            accessibilityRole="button"
            accessibilityLabel="Register new reader"
          >
            <Ionicons name={showRegister ? 'close' : 'add-circle-outline'} size={26} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.primary} />
        }
      >
        {/* Default Reader Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>Default Reader</Text>
          <View style={styles.card}>
            <View style={styles.defaultInfoRow}>
              <Ionicons name={preferredReader ? 'hardware-chip' : 'phone-portrait-outline'} size={18} color={preferredReader ? colors.primary : colors.textMuted} />
              <Text style={styles.defaultInfoValue} maxFontSizeMultiplier={1.3} numberOfLines={1}>
                {preferredReader
                  ? `${preferredReader.label || preferredReader.deviceType} (${preferredReader.readerType === 'internet' ? 'Internet' : 'Bluetooth'})`
                  : 'None — using Tap to Pay'}
              </Text>
              {preferredReader && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={handleClearDefault}
                  accessibilityRole="button"
                  accessibilityLabel="Clear default reader"
                >
                  <Text style={styles.clearButtonText} maxFontSizeMultiplier={1.3}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Connected Reader */}
        {isConnected && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>Connected</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
                <View style={styles.rowLeft}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.readerName} maxFontSizeMultiplier={1.3}>
                      {connectedReaderLabel || (connectedReaderType === 'tapToPay' ? 'Tap to Pay' : 'Bluetooth Reader')}
                    </Text>
                  </View>
                  <Text style={styles.readerDetail} maxFontSizeMultiplier={1.5}>
                    {connectedReaderType === 'tapToPay' ? 'Built-in NFC' : 'Bluetooth'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleDisconnect}
                  accessibilityRole="button"
                  accessibilityLabel="Disconnect reader"
                >
                  <Text style={{ color: colors.error, fontFamily: fonts.medium, fontSize: 14 }} maxFontSizeMultiplier={1.3}>
                    Disconnect
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Register New Reader */}
        {showRegister && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>Register New Reader</Text>
            <View style={styles.card}>
              <View style={styles.registerForm}>
                <TextInput
                  style={styles.input}
                  value={registrationCode}
                  onChangeText={setRegistrationCode}
                  placeholder="Registration code (from reader screen)"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Registration code"
                />
                <TextInput
                  style={styles.input}
                  value={readerLabel}
                  onChangeText={setReaderLabel}
                  placeholder="Label (optional, e.g. 'Bar Reader 1')"
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel="Reader label"
                />
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() => { setShowRegister(false); setRegistrationCode(''); setReaderLabel(''); }}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel registration"
                  >
                    <Text style={styles.secondaryButtonText} maxFontSizeMultiplier={1.3}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryButton, registerMutation.isPending && { opacity: 0.6 }]}
                    onPress={handleRegister}
                    disabled={registerMutation.isPending}
                    accessibilityRole="button"
                    accessibilityLabel="Register reader"
                  >
                    {registerMutation.isPending ? (
                      <ActivityIndicator size="small" color="#FFFFFF" accessibilityLabel="Registering" />
                    ) : (
                      <Text style={styles.primaryButtonText} maxFontSizeMultiplier={1.3}>Register</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Registered Readers */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>Registered Readers</Text>
          <View style={styles.card}>
            {isLoading ? (
              <View style={styles.emptyState}>
                <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Loading readers" />
              </View>
            ) : readers.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="hardware-chip-outline" size={40} color={colors.textMuted} />
                <Text style={styles.emptyText} maxFontSizeMultiplier={1.5}>
                  No physical readers registered.{'\n'}Tap + to register a reader using the code on its screen.
                </Text>
              </View>
            ) : (
              readers.map((reader, index) => {
                const isDefault = preferredReader?.id === reader.id;
                return (
                  <React.Fragment key={reader.id}>
                    {index > 0 && <View style={styles.divider} />}
                    <TouchableOpacity
                      style={styles.row}
                      onPress={() => handleReaderAction(reader)}
                      accessibilityRole="button"
                      accessibilityLabel={`${reader.label || reader.deviceType}, ${reader.status || 'unknown status'}${isDefault ? ', default reader' : ''}. Tap for options`}
                    >
                      <View style={[styles.statusDot, {
                        backgroundColor: reader.status === 'online' ? colors.success : colors.textMuted,
                      }]} />
                      <View style={styles.rowLeft}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={styles.readerName} maxFontSizeMultiplier={1.3}>
                            {reader.label || reader.deviceType}
                          </Text>
                          {isDefault && (
                            <View style={styles.defaultBadge}>
                              <Text style={styles.defaultBadgeText} maxFontSizeMultiplier={1.3}>Default</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.readerDetail} maxFontSizeMultiplier={1.5}>
                          {reader.deviceType}{reader.serialNumber ? ` · ${reader.serialNumber}` : ''}{reader.status ? ` · ${reader.status}` : ''}
                        </Text>
                      </View>
                      <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                  </React.Fragment>
                );
              })
            )}
          </View>
        </View>

        {/* Bluetooth Scan */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>Bluetooth Readers</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleBluetoothScan}
              disabled={isScanning}
              accessibilityRole="button"
              accessibilityLabel={isScanning ? 'Scanning for Bluetooth readers' : 'Scan for Bluetooth readers'}
            >
              {isScanning ? (
                <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Scanning" />
              ) : (
                <Ionicons name="bluetooth" size={20} color={colors.primary} />
              )}
              <Text style={styles.actionButtonText} maxFontSizeMultiplier={1.3}>
                {isScanning ? 'Scanning...' : 'Scan for Bluetooth Readers'}
              </Text>
            </TouchableOpacity>

            {bluetoothReaders.length > 0 && (
              <>
                <View style={styles.divider} />
                {bluetoothReaders.map((reader, index) => {
                  const serial = reader.serialNumber || reader.id;
                  const isThisConnecting = connectingSerial === serial;
                  return (
                    <React.Fragment key={serial || index}>
                      {index > 0 && <View style={styles.divider} />}
                      <TouchableOpacity
                        style={[styles.row, isThisConnecting && { opacity: 0.6 }]}
                        onPress={() => handleConnectBluetooth(reader)}
                        disabled={!!connectingSerial}
                        accessibilityRole="button"
                        accessibilityLabel={isThisConnecting ? 'Connecting to reader' : `Connect to ${reader.label || reader.serialNumber || 'reader'}`}
                      >
                        {isThisConnecting ? (
                          <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />
                        ) : (
                          <View style={[styles.statusDot, { backgroundColor: colors.primary }]} />
                        )}
                        <View style={styles.rowLeft}>
                          <Text style={styles.readerName} maxFontSizeMultiplier={1.3}>
                            {reader.label || reader.serialNumber || 'Unknown Reader'}
                          </Text>
                          <Text style={styles.readerDetail} maxFontSizeMultiplier={1.5}>
                            {isThisConnecting ? 'Connecting...' : `${reader.deviceType || 'Bluetooth'} · Tap to connect`}
                          </Text>
                        </View>
                        {!isThisConnecting && (
                          <Ionicons name="link-outline" size={20} color={colors.primary} />
                        )}
                      </TouchableOpacity>
                    </React.Fragment>
                  );
                })}
              </>
            )}
          </View>
        </View>

        <View style={{ height: insets.bottom + 32 }} />
      </ScrollView>

    </View>
  );
}
