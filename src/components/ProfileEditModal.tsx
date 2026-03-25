import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import PhoneInput, { ICountry, isValidPhoneNumber } from 'react-native-international-phone-number';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../lib/api/client';
import { glass } from '../lib/colors';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import logger from '../lib/logger';

interface ProfileEditModalProps {
  visible: boolean;
  onClose: () => void;
}

export function ProfileEditModal({ visible, onClose }: ProfileEditModalProps) {
  const { colors, isDark } = useTheme();
  const { user, refreshAuth } = useAuth();
  const insets = useSafeAreaInsets();
  const glassColors = isDark ? glass.dark : glass.light;
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [selectedCountry, setSelectedCountry] = useState<ICountry | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (visible && user) {
      setFirstName(user.firstName || '');
      setLastName(user.lastName || '');
      // Phone from API is 10 digits, store as-is
      setPhone(user.phone || '');
      setAvatarPreview(null);
    }
  }, [visible, user]);

  const pickImage = async () => {
    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photo library to change your profile picture.');
        return;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setAvatarPreview(asset.uri);
        await uploadAvatar(asset.uri);
      }
    } catch (error) {
      logger.error('[ProfileEditModal] Error picking image:', error);
      Alert.alert('Error', 'Failed to select image. Please try again.');
    }
  };

  const takePhoto = async () => {
    try {
      // Request permission
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your camera to take a photo.');
        return;
      }

      // Launch camera
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setAvatarPreview(asset.uri);
        await uploadAvatar(asset.uri);
      }
    } catch (error) {
      logger.error('[ProfileEditModal] Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  };

  const uploadAvatar = async (uri: string) => {
    setIsUploadingAvatar(true);
    try {
      // Create form data
      const formData = new FormData();
      const filename = uri.split('/').pop() || 'avatar.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';

      formData.append('file', {
        uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
        name: filename,
        type,
      } as any);

      await apiClient.postForm('/auth/avatar', formData);
      await refreshAuth();

      logger.log('[ProfileEditModal] Avatar uploaded successfully');
    } catch (error: any) {
      logger.error('[ProfileEditModal] Error uploading avatar:', error);
      Alert.alert('Upload Failed', error.message || 'Failed to upload profile picture.');
      setAvatarPreview(null);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const showImageOptions = () => {
    Alert.alert(
      'Change Profile Picture',
      'Choose an option',
      [
        { text: 'Take Photo', onPress: takePhoto },
        { text: 'Choose from Library', onPress: pickImage },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updateData: any = {};

      if (firstName !== (user?.firstName || '')) {
        updateData.firstName = firstName;
      }
      if (lastName !== (user?.lastName || '')) {
        updateData.lastName = lastName;
      }

      // Phone validation and update
      const cleanPhone = phone.replace(/\D/g, '');
      const originalPhone = (user?.phone || '').replace(/\D/g, '');
      if (cleanPhone !== originalPhone) {
        if (cleanPhone.length === 0) {
          updateData.phone = null;
        } else if (selectedCountry && !isValidPhoneNumber(phone, selectedCountry)) {
          Alert.alert('Invalid Phone', 'Please enter a valid phone number.');
          setIsSaving(false);
          return;
        } else {
          // Store national digits (strip country code if present)
          if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
            updateData.phone = cleanPhone.slice(1);
          } else {
            updateData.phone = cleanPhone;
          }
        }
      }

      if (Object.keys(updateData).length > 0) {
        await apiClient.patch('/auth/profile', updateData);
        await refreshAuth();
      }

      onClose();
    } catch (error: any) {
      logger.error('[ProfileEditModal] Error saving profile:', error);
      Alert.alert('Save Failed', error.error || error.message || 'Failed to save profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges = () => {
    const cleanPhone = phone.replace(/\D/g, '');
    const originalPhone = (user?.phone || '').replace(/\D/g, '');
    // Handle E.164 format comparison
    const normalizedPhone = cleanPhone.length === 11 && cleanPhone.startsWith('1')
      ? cleanPhone.slice(1)
      : cleanPhone;
    return (
      firstName !== (user?.firstName || '') ||
      lastName !== (user?.lastName || '') ||
      normalizedPhone !== originalPhone
    );
  };

  const getInitials = () => {
    const first = user?.firstName?.charAt(0)?.toUpperCase() || '';
    const last = user?.lastName?.charAt(0)?.toUpperCase() || '';
    return `${first}${last}` || user?.email?.charAt(0)?.toUpperCase() || 'U';
  };

  const displayAvatarUrl = avatarPreview || user?.avatarUrl;

  const styles = createStyles(colors, glassColors, isDark);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerButton} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.cancelText} maxFontSizeMultiplier={1.3}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title} maxFontSizeMultiplier={1.3}>Edit Profile</Text>
          <TouchableOpacity
            onPress={handleSave}
            style={styles.headerButton}
            disabled={isSaving || !hasChanges()}
            accessibilityRole="button"
            accessibilityLabel={isSaving ? 'Saving profile' : 'Save profile'}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.primary} accessibilityLabel="Saving" />
            ) : (
              <Text style={[styles.saveText, !hasChanges() && styles.saveTextDisabled]} maxFontSizeMultiplier={1.3}>
                Save
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
          {/* Avatar Section */}
          <View style={styles.avatarSection}>
            <TouchableOpacity
              style={styles.avatarContainer}
              onPress={showImageOptions}
              disabled={isUploadingAvatar}
              accessibilityRole="button"
              accessibilityLabel="Change profile picture"
              accessibilityHint="Opens options to take a photo or choose from library"
            >
              {displayAvatarUrl ? (
                <Image source={{ uri: displayAvatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitials} maxFontSizeMultiplier={1.2}>{getInitials()}</Text>
                </View>
              )}
              {isUploadingAvatar ? (
                <View style={styles.avatarOverlay}>
                  <ActivityIndicator size="small" color="#fff" accessibilityLabel="Uploading profile picture" />
                </View>
              ) : (
                <View style={styles.cameraButton}>
                  <Ionicons name="camera" size={16} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={showImageOptions} disabled={isUploadingAvatar} accessibilityRole="button" accessibilityLabel={isUploadingAvatar ? 'Uploading photo' : 'Change photo'}>
              <Text style={styles.changePhotoText} maxFontSizeMultiplier={1.3}>
                {isUploadingAvatar ? 'Uploading...' : 'Change Photo'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Form Fields */}
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>First Name</Text>
              <TextInput
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First name"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
                autoCorrect={false}
                accessibilityLabel="First name"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>Last Name</Text>
              <TextInput
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Last name"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
                autoCorrect={false}
                accessibilityLabel="Last name"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>Phone Number</Text>
              <PhoneInput
                defaultValue={phone ? `+1${phone}` : undefined}
                onChangePhoneNumber={(text) => setPhone(text.replace(/\D/g, ''))}
                selectedCountry={selectedCountry}
                onChangeSelectedCountry={setSelectedCountry}
                defaultCountry="US"
                placeholder="(555) 123-4567"
                disabled={isSaving}
                theme={isDark ? 'dark' : 'light'}
                phoneInputStyles={{
                  container: styles.phoneContainer,
                  flagContainer: styles.phoneFlagContainer,
                  callingCode: styles.phoneCode,
                  input: styles.phoneInput,
                  divider: styles.phoneDivider,
                  caret: styles.phoneCaret,
                }}
                modalStyles={isDark ? {
                  content: { backgroundColor: colors.card },
                  searchInput: { backgroundColor: colors.background, borderColor: colors.border, color: colors.text },
                  countryItem: { backgroundColor: colors.background, borderColor: colors.border },
                  closeButton: { backgroundColor: colors.background, borderColor: colors.border },
                } : undefined}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label} maxFontSizeMultiplier={1.5}>Email</Text>
              <View style={styles.emailContainer}>
                <Text style={styles.emailText} maxFontSizeMultiplier={1.5}>{user?.email}</Text>
                <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
              </View>
              <Text style={styles.emailHint} maxFontSizeMultiplier={1.5}>Email cannot be changed</Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const createStyles = (colors: any, glassColors: typeof glass.dark, isDark: boolean) => {
  const cardBackground = isDark ? '#181819' : 'rgba(255,255,255,0.95)';
  const inputBackground = isDark ? '#0f0f10' : '#f5f5f5';

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDark ? '#09090b' : colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 56,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    },
    headerButton: {
      minWidth: 60,
    },
    title: {
      fontSize: 17,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    cancelText: {
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.primary,
    },
    saveText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.primary,
      textAlign: 'right',
    },
    saveTextDisabled: {
      opacity: 0.4,
    },
    content: {
      flex: 1,
    },
    scrollContent: {
      padding: 24,
    },
    avatarSection: {
      alignItems: 'center',
      marginBottom: 32,
    },
    avatarContainer: {
      position: 'relative',
      marginBottom: 12,
    },
    avatar: {
      width: 100,
      height: 100,
      borderRadius: 50,
    },
    avatarPlaceholder: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: colors.primary + '25',
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitials: {
      fontSize: 36,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    avatarOverlay: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: 50,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cameraButton: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: isDark ? '#09090b' : colors.background,
    },
    changePhotoText: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: colors.primary,
    },
    form: {
      gap: 20,
    },
    inputGroup: {
      gap: 8,
    },
    label: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
      marginLeft: 4,
    },
    input: {
      backgroundColor: cardBackground,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.text,
      borderWidth: 1,
      borderColor: isDark ? '#1d1d1f' : 'rgba(0,0,0,0.08)',
    },
    emailContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: inputBackground,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderWidth: 1,
      borderColor: isDark ? '#1d1d1f' : 'rgba(0,0,0,0.08)',
    },
    emailText: {
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.textMuted,
    },
    emailHint: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      marginLeft: 4,
      marginTop: 4,
    },
    phoneContainer: {
      backgroundColor: cardBackground,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: isDark ? '#1d1d1f' : 'rgba(0,0,0,0.08)',
    },
    phoneFlagContainer: {
      backgroundColor: isDark ? '#181819' : '#F3F4F6',
      borderTopLeftRadius: 11,
      borderBottomLeftRadius: 11,
    },
    phoneInput: {
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.text,
      minHeight: 48,
    },
    phoneCode: {
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.text,
    },
    phoneDivider: {
      backgroundColor: isDark ? '#555' : 'rgba(0,0,0,0.12)',
    },
    phoneCaret: {
      color: colors.textSecondary,
    },
  });
};
