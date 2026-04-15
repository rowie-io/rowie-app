import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useTerminal } from '../context/StripeTerminalContext';
import { stripeTerminalApi } from '../lib/api';
import { sessionsApi } from '../lib/api/sessions';
import { getDeviceId } from '../lib/device';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import logger from '../lib/logger';

export function OpenTabScreen() {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { selectedCatalog } = useCatalog();
  const { isConnected, processSetupIntent, isProcessing } = useTerminal();

  const [customerName, setCustomerName] = useState('');
  const [stage, setStage] = useState<'idle' | 'creating' | 'tapping' | 'opening' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleOpenTab = useCallback(async () => {
    if (!selectedCatalog) {
      Alert.alert('No menu selected', 'Please select a menu before opening a tab.');
      return;
    }

    const trimmedName = customerName.trim();
    if (!trimmedName) {
      Alert.alert('Name required', 'Please enter a name for this tab so staff can identify it.');
      return;
    }

    if (!isConnected) {
      Alert.alert('Tap to Pay not ready', 'Connect the Tap to Pay reader before opening a tab.');
      return;
    }

    setError(null);
    setStage('creating');

    // Track session for cleanup on failure
    let createdSessionId: string | null = null;

    try {
      // 1. Create the session (source='tab', no items yet)
      const deviceId = await getDeviceId();
      const sessionResult = await sessionsApi.create({
        catalogId: selectedCatalog.id,
        source: 'hold', // Start as hold, flip to tab after payment method saved
        holdName: trimmedName,
        customerName: trimmedName,
        deviceId,
      });
      createdSessionId = sessionResult.session.id;
      logger.log('[OpenTab] Session created', createdSessionId);

      // 2. Create a SetupIntent on the connected account
      const setupIntent = await stripeTerminalApi.createSetupIntent({
        customerName: trimmedName,
        description: `Tab: ${trimmedName}`,
      });
      logger.log('[OpenTab] SetupIntent created', setupIntent.id);

      // 3. Prompt customer to tap card
      setStage('tapping');
      const collected = await processSetupIntent(setupIntent.clientSecret);
      logger.log('[OpenTab] Card saved', collected.paymentMethodId);

      // 4. Attach the payment method to the session (opens the tab)
      setStage('opening');
      await sessionsApi.openTab(createdSessionId, {
        stripeSetupIntentId: collected.setupIntentId,
        stripePaymentMethodId: collected.paymentMethodId,
        customerName: trimmedName,
      });

      setStage('done');

      // Navigate to the session detail screen
      navigation.replace('SessionDetail', { sessionId: createdSessionId });
    } catch (err: any) {
      logger.error('[OpenTab] Failed', err);
      // Clean up the dangling session so it doesn't pollute the active list
      if (createdSessionId) {
        try {
          await sessionsApi.cancel(createdSessionId, 'Tab setup failed');
        } catch (cleanupErr) {
          logger.warn('[OpenTab] Cleanup failed', cleanupErr);
        }
      }
      setError(err?.message || 'Failed to open tab');
      setStage('idle');
    }
  }, [customerName, selectedCatalog, isConnected, processSetupIntent, navigation]);

  const getStageText = () => {
    switch (stage) {
      case 'creating':
        return 'Creating tab...';
      case 'tapping':
        return 'Ready — ask guest to tap card';
      case 'opening':
        return 'Saving card...';
      case 'done':
        return 'Tab opened';
      default:
        return null;
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Cancel and close"
          // Disable close once the flow has started — we have a session on
          // the backend that would leak if the user bails mid-setup. Only
          // 'idle' (not started) and 'done' (already navigated) are safe.
          disabled={isProcessing || (stage !== 'idle' && stage !== 'done')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
          Open a Tab
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.iconBubble, { backgroundColor: colors.primary + '20' }]}>
            <Ionicons name="wallet-outline" size={32} color={colors.primary} />
          </View>

          <Text style={[styles.title, { color: colors.text }]} maxFontSizeMultiplier={1.2}>
            Start a tab
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
            The card will be saved for later charging. The guest won't be charged until you close the tab.
          </Text>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
              Tab name
            </Text>
            <TextInput
              value={customerName}
              onChangeText={setCustomerName}
              placeholder="e.g. John's Tab"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
              maxLength={100}
              autoCapitalize="words"
              editable={stage === 'idle'}
              accessibilityLabel="Tab name"
              returnKeyType="done"
              onSubmitEditing={handleOpenTab}
            />
          </View>

          {stage !== 'idle' && (
            <View style={[styles.statusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <ActivityIndicator
                size="small"
                color={colors.primary}
                accessibilityLabel={getStageText() || 'Processing'}
              />
              <Text style={[styles.statusText, { color: colors.text }]} maxFontSizeMultiplier={1.5}>
                {getStageText()}
              </Text>
            </View>
          )}

          {error && (
            <View
              style={[styles.errorCard, { backgroundColor: '#EF444410', borderColor: '#EF444440' }]}
              accessibilityRole="alert"
            >
              <Ionicons name="alert-circle-outline" size={18} color="#EF4444" />
              <Text style={styles.errorText} maxFontSizeMultiplier={1.5}>
                {error}
              </Text>
            </View>
          )}

          {!isConnected && (
            <View
              style={[styles.warnCard, { backgroundColor: '#F59E0B10', borderColor: '#F59E0B40' }]}
              accessibilityRole="alert"
            >
              <Ionicons name="wifi-outline" size={18} color="#F59E0B" />
              <Text style={styles.warnText} maxFontSizeMultiplier={1.5}>
                Tap to Pay reader not connected.
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            onPress={handleOpenTab}
            disabled={!isConnected || isProcessing || !customerName.trim() || stage !== 'idle'}
            style={[
              styles.payButton,
              { backgroundColor: isDark ? '#fff' : '#1C1917' },
              (!isConnected || isProcessing || !customerName.trim() || stage !== 'idle') && styles.payButtonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Tap to open tab"
          >
            {isProcessing || stage !== 'idle' ? (
              <ActivityIndicator
                color={isDark ? '#1C1917' : '#fff'}
                accessibilityLabel="Processing"
              />
            ) : (
              <>
                <Ionicons name="wifi" size={22} color={isDark ? '#1C1917' : '#fff'} style={styles.tapIcon} />
                <Text
                  style={[styles.payButtonText, { color: isDark ? '#1C1917' : '#fff' }]}
                  maxFontSizeMultiplier={1.3}
                >
                  Tap Card to Open
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { fontSize: 18, fontFamily: fonts.bold },
  content: {
    padding: 24,
    gap: 16,
    alignItems: 'center',
  },
  iconBubble: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: { fontSize: 24, fontFamily: fonts.bold, textAlign: 'center' },
  subtitle: { fontSize: 15, fontFamily: fonts.regular, textAlign: 'center', paddingHorizontal: 16, lineHeight: 22 },
  field: { width: '100%', gap: 8, marginTop: 16 },
  label: { fontSize: 13, fontFamily: fonts.semiBold, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: fonts.regular,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    width: '100%',
  },
  statusText: { fontSize: 14, fontFamily: fonts.medium, flex: 1 },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    width: '100%',
  },
  errorText: { fontSize: 14, fontFamily: fonts.medium, color: '#EF4444', flex: 1 },
  warnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    width: '100%',
  },
  warnText: { fontSize: 14, fontFamily: fonts.medium, color: '#F59E0B', flex: 1 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
  },
  payButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: 56,
    borderRadius: 16,
    ...shadows.md,
  },
  payButtonDisabled: { opacity: 0.5 },
  payButtonText: { fontSize: 17, fontFamily: fonts.bold },
  tapIcon: { transform: [{ rotate: '90deg' }] },
});
