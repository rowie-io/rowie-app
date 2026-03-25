import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface StarBackgroundProps {
  colors: any;
  isDark: boolean;
  children: React.ReactNode;
}

export function StarBackground({ colors, isDark, children }: StarBackgroundProps) {
  const sparkleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(sparkleAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(sparkleAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  if (!isDark) {
    return <View style={{ flex: 1, backgroundColor: colors.background }}>{children}</View>;
  }

  const starColor1 = 'rgba(255,255,255,0.7)';
  const starColor2 = 'rgba(255,255,255,0.5)';
  const starColor3 = 'rgba(255,255,255,0.4)';

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['transparent', 'rgba(99, 102, 241, 0.08)', 'rgba(139, 92, 246, 0.05)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={[StyleSheet.absoluteFill, { zIndex: 0 }]} pointerEvents="none">
        {/* First set of stars - fade in */}
        <Animated.View style={{ opacity: sparkleAnim }}>
          <View style={[styles.star, { top: 60, left: 30, width: 6, height: 6, backgroundColor: starColor1, borderRadius: 3 }]} />
          <View style={[styles.star, { top: 120, right: 50, width: 4, height: 4, backgroundColor: starColor2, borderRadius: 2 }]} />
          <View style={[styles.star, { top: 200, left: SCREEN_WIDTH * 0.4, width: 5, height: 5, backgroundColor: starColor3, borderRadius: 2.5 }]} />
          <View style={[styles.star, { top: 280, right: 80, width: 3, height: 3, backgroundColor: starColor2, borderRadius: 1.5 }]} />
          <View style={[styles.star, { top: 400, left: 70, width: 4, height: 4, backgroundColor: starColor2, borderRadius: 2 }]} />
          <View style={[styles.star, { top: 500, right: 40, width: 5, height: 5, backgroundColor: starColor3, borderRadius: 2.5 }]} />
          <View style={[styles.star, { top: 620, left: SCREEN_WIDTH * 0.25, width: 3, height: 3, backgroundColor: starColor1, borderRadius: 1.5 }]} />
        </Animated.View>
        {/* Second set of stars - fade out (opposite phase) */}
        <Animated.View style={{ opacity: Animated.subtract(1, sparkleAnim) }}>
          <View style={[styles.star, { top: 80, left: 60, width: 4, height: 4, backgroundColor: starColor2, borderRadius: 2 }]} />
          <View style={[styles.star, { top: 150, right: 35, width: 6, height: 6, backgroundColor: starColor1, borderRadius: 3 }]} />
          <View style={[styles.star, { top: 220, left: 45, width: 3, height: 3, backgroundColor: starColor3, borderRadius: 1.5 }]} />
          <View style={[styles.star, { top: 300, left: SCREEN_WIDTH * 0.6, width: 5, height: 5, backgroundColor: starColor2, borderRadius: 2.5 }]} />
          <View style={[styles.star, { top: 450, right: 90, width: 4, height: 4, backgroundColor: starColor1, borderRadius: 2 }]} />
          <View style={[styles.star, { top: 550, left: SCREEN_WIDTH * 0.3, width: 3, height: 3, backgroundColor: starColor3, borderRadius: 1.5 }]} />
          <View style={[styles.star, { top: 680, right: 60, width: 5, height: 5, backgroundColor: starColor2, borderRadius: 2.5 }]} />
        </Animated.View>
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  star: {
    position: 'absolute',
  },
  content: {
    flex: 1,
    zIndex: 1,
  },
});
