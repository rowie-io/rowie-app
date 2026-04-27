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
import { useTranslations } from '../lib/i18n';
import { useTerminal, classifyReaderType } from '../context/StripeTerminalContext';
import type { PreferredReader } from '../context/StripeTerminalContext';
import { stripeTerminalApi, TerminalReader } from '../lib/api/stripe-terminal';
import { fonts } from '../lib/fonts';

export function ReaderManagementScreen() {
  const { colors, isDark } = useTheme();
  const t = useTranslations('tapToPay');
  const tc = useTranslations('common');
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
      Alert.alert(t('readerRegisteredTitle'), t('readerRegisteredMessage'));
    },
    onError: (error: any) => {
      // stripeTerminalApi.registerReader throws ApiError {error, ...} from
      // apiClient — not an Error instance — so prefer `.error`.
      Alert.alert(t('readerRegistrationFailedTitle'), error?.error || error?.message || t('readerRegistrationFailedMessage'));
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
      // stripeTerminalApi.deleteReader throws ApiError {error, ...} from
      // apiClient — not an Error instance — so prefer `.error`.
      Alert.alert(t('readerDeleteFailedTitle'), error?.error || error?.message || t('readerDeleteFailedMessage'));
    },
  });

  const handleRegister = useCallback(() => {
    if (!registrationCode.trim()) {
      Alert.alert(t('readerMissingCodeTitle'), t('readerMissingCodeMessage'));
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
      isDefault ? t('readerIsDefaultMessage') : `${reader.status || t('readerUnknownStatus')}`,
      [
        {
          text: isDefault ? t('readerActionClearDefault') : t('readerActionSetDefault'),
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
          text: t('readerActionDelete'),
          style: 'destructive',
          onPress: () => deleteMutation.mutate(reader.id),
        },
        { text: tc('cancel'), style: 'cancel' },
      ]
    );
  }, [preferredReader, setPreferredReader, clearPreferredReader, deleteMutation]);

  const handleBluetoothScan = useCallback(async () => {
    try {
      const found = await scanForBluetoothReaders();
      if (found.length === 0) {
        Alert.alert(
          t('readerNoReadersFoundTitle'),
          t('readerNoReadersFoundMessage'),
        );
      }
    } catch (err: any) {
      const message = err.message || t('readerScanFailedMessage');
      Alert.alert(t('readerScanFailedTitle'), message);
    }
  }, [scanForBluetoothReaders]);

  const handleConnectBluetooth = useCallback(async (reader: any) => {
    const serial = reader.serialNumber || reader.id;
    setConnectingSerial(serial);
    try {
      await connectReader('bluetoothScan', reader);
      await setPreferredReader({
        id: serial,
        label: reader.label || reader.serialNumber || t('readerBluetoothReader'),
        deviceType: reader.deviceType || 'bluetooth',
        readerType: 'bluetooth',
      });
    } catch (err: any) {
      Alert.alert(t('readerConnectionFailedTitle'), err.message || t('readerConnectionFailedMessage'));
    } finally {
      setConnectingSerial(null);
    }
  }, [connectReader, setPreferredReader]);

  const handleDisconnect = useCallback(async () => {
    await disconnectReader();
  }, [disconnectReader]);

  const handleClearDefault = useCallback(() => {
    Alert.alert(
      t('readerClearDefaultAlertTitle'),
      t('readerClearDefaultAlertMessage'),
      [
        { text: tc('cancel'), style: 'cancel' },
        {
          text: t('readerClearDefault'),
          style: 'destructive',
          onPress: () => clearPreferredReader(),
        },
      ]
    );
  }, [clearPreferredReader]);

  const cardBorder = colors.border;

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
      backgroundColor: colors.card,
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
          accessibilityLabel={t('readerGoBackAccessibilityLabel')}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>{t('readerHeaderTitle')}</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => setShowRegister(!showRegister)}
            accessibilityRole="button"
            accessibilityLabel={t('readerRegisterAccessibilityLabel')}
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
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>{t('readerSectionDefaultReader')}</Text>
          <View style={styles.card}>
            <View style={styles.defaultInfoRow}>
              <Ionicons name={preferredReader ? 'hardware-chip' : 'phone-portrait-outline'} size={18} color={preferredReader ? colors.primary : colors.textMuted} />
              <Text style={styles.defaultInfoValue} maxFontSizeMultiplier={1.3} numberOfLines={1}>
                {preferredReader
                  ? t('readerDefaultValueWithReader', { label: preferredReader.label || preferredReader.deviceType, connectionType: preferredReader.readerType === 'internet' ? t('readerConnectionTypeInternet') : t('readerConnectionTypeBluetooth') })
                  : t('readerDefaultValueNone')}
              </Text>
              {preferredReader && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={handleClearDefault}
                  accessibilityRole="button"
                  accessibilityLabel={t('readerClearDefaultAccessibilityLabel')}
                >
                  <Text style={styles.clearButtonText} maxFontSizeMultiplier={1.3}>{t('readerClearDefault')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Connected Reader */}
        {isConnected && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>{t('readerSectionConnected')}</Text>
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
                <View style={styles.rowLeft}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.readerName} maxFontSizeMultiplier={1.3}>
                      {connectedReaderLabel || (connectedReaderType === 'tapToPay' ? t('readerTapToPay') : t('readerBluetoothReader'))}
                    </Text>
                  </View>
                  <Text style={styles.readerDetail} maxFontSizeMultiplier={1.5}>
                    {connectedReaderType === 'tapToPay' ? t('readerBuiltInNfc') : t('readerBluetooth')}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleDisconnect}
                  accessibilityRole="button"
                  accessibilityLabel={t('readerDisconnectAccessibilityLabel')}
                >
                  <Text style={{ color: colors.error, fontFamily: fonts.medium, fontSize: 14 }} maxFontSizeMultiplier={1.3}>
                    {t('readerDisconnect')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Register New Reader */}
        {showRegister && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>{t('readerSectionRegisterNew')}</Text>
            <View style={styles.card}>
              <View style={styles.registerForm}>
                <TextInput
                  style={styles.input}
                  value={registrationCode}
                  onChangeText={setRegistrationCode}
                  placeholder={t('readerRegistrationCodePlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel={t('readerRegistrationCodeAccessibilityLabel')}
                />
                <TextInput
                  style={styles.input}
                  value={readerLabel}
                  onChangeText={setReaderLabel}
                  placeholder={t('readerLabelPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel={t('readerLabelAccessibilityLabel')}
                />
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() => { setShowRegister(false); setRegistrationCode(''); setReaderLabel(''); }}
                    accessibilityRole="button"
                    accessibilityLabel={t('readerCancelRegistrationAccessibilityLabel')}
                  >
                    <Text style={styles.secondaryButtonText} maxFontSizeMultiplier={1.3}>{tc('cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryButton, registerMutation.isPending && { opacity: 0.6 }]}
                    onPress={handleRegister}
                    disabled={registerMutation.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={t('readerRegisterAccessibilityLabel')}
                  >
                    {registerMutation.isPending ? (
                      <ActivityIndicator size="small" color="#FFFFFF" accessibilityLabel={t('readerRegistering')} />
                    ) : (
                      <Text style={styles.primaryButtonText} maxFontSizeMultiplier={1.3}>{t('readerRegister')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* Registered Readers */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>{t('readerSectionRegisteredReaders')}</Text>
          <View style={styles.card}>
            {isLoading ? (
              <View style={styles.emptyState}>
                <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={t('readerLoadingReaders')} />
                <Text style={[styles.emptyText, { marginTop: 12 }]} maxFontSizeMultiplier={1.5}>
                  {t('readerLoadingReaders')}
                </Text>
              </View>
            ) : readers.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="hardware-chip-outline" size={40} color={colors.textMuted} />
                <Text style={styles.emptyText} maxFontSizeMultiplier={1.5}>
                  {t('readerEmptyState')}
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
                      accessibilityLabel={t('readerRowAccessibilityLabel', { name: reader.label || reader.deviceType, status: reader.status || t('readerUnknownStatus'), defaultSuffix: isDefault ? t('readerRowDefaultSuffix') : '' })}
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
                              <Text style={styles.defaultBadgeText} maxFontSizeMultiplier={1.3}>{t('readerDefaultBadge')}</Text>
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
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>{t('readerSectionBluetooth')}</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleBluetoothScan}
              disabled={isScanning}
              accessibilityRole="button"
              accessibilityLabel={isScanning ? t('readerScanningAccessibilityLabel') : t('readerScanBluetoothAccessibilityLabel')}
            >
              {isScanning ? (
                <ActivityIndicator size="small" color={colors.primary} accessibilityLabel={t('readerScanning')} />
              ) : (
                <Ionicons name="bluetooth" size={20} color={colors.primary} />
              )}
              <Text style={styles.actionButtonText} maxFontSizeMultiplier={1.3}>
                {isScanning ? t('readerScanning') : t('readerScanBluetooth')}
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
                        accessibilityLabel={isThisConnecting ? t('readerConnectingAccessibilityLabel') : t('readerConnectToAccessibilityLabel', { name: reader.label || reader.serialNumber || t('readerUnknownReader') })}
                      >
                        {isThisConnecting ? (
                          <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />
                        ) : (
                          <View style={[styles.statusDot, { backgroundColor: colors.primary }]} />
                        )}
                        <View style={styles.rowLeft}>
                          <Text style={styles.readerName} maxFontSizeMultiplier={1.3}>
                            {reader.label || reader.serialNumber || t('readerUnknownReader')}
                          </Text>
                          <Text style={styles.readerDetail} maxFontSizeMultiplier={1.5}>
                            {isThisConnecting ? t('readerConnecting') : `${reader.deviceType || t('readerBluetooth')} · ${t('readerTapToConnect')}`}
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
