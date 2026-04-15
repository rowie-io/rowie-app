import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { translate } from '../lib/i18n';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Inner class component to catch errors (React requires class for getDerivedStateFromError)
class ErrorCatcher extends React.Component<
  { children: React.ReactNode; onError: (error: Error) => void; hasError: boolean },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  componentDidUpdate(prevProps: any) {
    if (prevProps.hasError && !this.props.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

// Functional fallback UI. Uses the non-hook `translate()` because the
// boundary sits above LanguageProvider in the tree.
function ErrorFallback({ onReset }: { onReset: () => void }) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="warning-outline" size={48} color="#ef4444" />
        </View>
        <Text style={styles.title} maxFontSizeMultiplier={1.3} accessibilityRole="header">
          {translate('components.errorBoundary.title')}
        </Text>
        <Text style={styles.message} maxFontSizeMultiplier={1.5}>
          {translate('components.errorBoundary.message')}
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={onReset}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={translate('components.errorBoundary.tryAgainLabel')}
          accessibilityHint={translate('components.errorBoundary.tryAgainHint')}
        >
          <Ionicons name="refresh-outline" size={20} color="#FFFFFF" />
          <Text style={styles.buttonText} maxFontSizeMultiplier={1.3}>{translate('components.errorBoundary.tryAgainButton')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Public ErrorBoundary — functional wrapper around the class error catcher
export function ErrorBoundary({ children, fallback }: ErrorBoundaryProps) {
  const [hasError, setHasError] = useState(false);

  const handleError = useCallback((error: Error) => {
    setHasError(true);
  }, []);

  const handleReset = useCallback(() => {
    setHasError(false);
  }, []);

  if (hasError) {
    return fallback || <ErrorFallback onReset={handleReset} />;
  }

  return (
    <ErrorCatcher onError={handleError} hasError={hasError}>
      {children}
    </ErrorCatcher>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1C1917',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  content: {
    alignItems: 'center',
    maxWidth: 320,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    color: '#A8A29E',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F59E0B',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
