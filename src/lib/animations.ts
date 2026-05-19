import { useRef, useCallback } from 'react';
import { Animated, Easing } from 'react-native';

// Spring animation presets
export const springPresets = {
  // Gentle spring - for subtle movements
  gentle: {
    tension: 40,
    friction: 7,
    useNativeDriver: true,
  },
  // Bouncy spring - for playful interactions
  bouncy: {
    tension: 100,
    friction: 8,
    useNativeDriver: true,
  },
  // Snappy spring - for quick responses
  snappy: {
    tension: 150,
    friction: 10,
    useNativeDriver: true,
  },
  // Stiff spring - for precise movements
  stiff: {
    tension: 200,
    friction: 15,
    useNativeDriver: true,
  },
};

// Timing animation presets
export const timingPresets = {
  // Fast fade
  fadeQuick: {
    duration: 150,
    easing: Easing.out(Easing.ease),
    useNativeDriver: true,
  },
  // Standard fade
  fade: {
    duration: 200,
    easing: Easing.out(Easing.ease),
    useNativeDriver: true,
  },
  // Slow fade
  fadeSlow: {
    duration: 300,
    easing: Easing.out(Easing.ease),
    useNativeDriver: true,
  },
  // Button press
  press: {
    duration: 100,
    easing: Easing.inOut(Easing.ease),
    useNativeDriver: true,
  },
  // Slide animations
  slideUp: {
    duration: 300,
    easing: Easing.out(Easing.back(1.2)),
    useNativeDriver: true,
  },
  slideDown: {
    duration: 250,
    easing: Easing.in(Easing.ease),
    useNativeDriver: true,
  },
};

// Hook for scale animation (button presses)
export const useScaleAnimation = (
  initialScale = 1,
  pressedScale = 0.96
) => {
  const scale = useRef(new Animated.Value(initialScale)).current;

  const onPressIn = useCallback(() => {
    Animated.timing(scale, {
      toValue: pressedScale,
      ...timingPresets.press,
    }).start();
  }, [scale, pressedScale]);

  const onPressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: initialScale,
      ...springPresets.snappy,
    }).start();
  }, [scale, initialScale]);

  return {
    scale,
    onPressIn,
    onPressOut,
    style: { transform: [{ scale }] },
  };
};

// Hook for fade animation
export const useFadeAnimation = (initialOpacity = 0) => {
  const opacity = useRef(new Animated.Value(initialOpacity)).current;

  const fadeIn = useCallback((duration = 200) => {
    return Animated.timing(opacity, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });
  }, [opacity]);

  const fadeOut = useCallback((duration = 200) => {
    return Animated.timing(opacity, {
      toValue: 0,
      duration,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    });
  }, [opacity]);

  return {
    opacity,
    fadeIn,
    fadeOut,
    style: { opacity },
  };
};

// Hook for slide animation
export const useSlideAnimation = (
  direction: 'up' | 'down' | 'left' | 'right' = 'up',
  distance = 20
) => {
  const translateValue = useRef(new Animated.Value(
    direction === 'up' || direction === 'left' ? distance : -distance
  )).current;

  const slideIn = useCallback(() => {
    return Animated.spring(translateValue, {
      toValue: 0,
      ...springPresets.gentle,
    });
  }, [translateValue]);

  const slideOut = useCallback(() => {
    const targetValue = direction === 'up' || direction === 'left' ? distance : -distance;
    return Animated.timing(translateValue, {
      toValue: targetValue,
      ...timingPresets.slideDown,
    });
  }, [translateValue, direction, distance]);

  const isVertical = direction === 'up' || direction === 'down';
  const transform = isVertical
    ? [{ translateY: translateValue }]
    : [{ translateX: translateValue }];

  return {
    translateValue,
    slideIn,
    slideOut,
    style: { transform },
  };
};

// Hook for combined fade + slide (common pattern)
export const useFadeSlideAnimation = (
  direction: 'up' | 'down' = 'up',
  distance = 20
) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(
    direction === 'up' ? distance : -distance
  )).current;

  const animateIn = useCallback(() => {
    return Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        ...timingPresets.fade,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        ...springPresets.gentle,
      }),
    ]);
  }, [opacity, translateY]);

  const animateOut = useCallback(() => {
    const targetY = direction === 'up' ? distance : -distance;
    return Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        ...timingPresets.fadeQuick,
      }),
      Animated.timing(translateY, {
        toValue: targetY,
        ...timingPresets.slideDown,
      }),
    ]);
  }, [opacity, translateY, direction, distance]);

  return {
    opacity,
    translateY,
    animateIn,
    animateOut,
    style: {
      opacity,
      transform: [{ translateY }],
    },
  };
};

// Staggered animation helper for lists
export const createStaggeredAnimation = (
  items: Animated.Value[],
  toValue: number,
  staggerDelay = 50
) => {
  return Animated.stagger(
    staggerDelay,
    items.map((item) =>
      Animated.spring(item, {
        toValue,
        ...springPresets.gentle,
      })
    )
  );
};

// Pulse animation for loading/attention states
export const usePulseAnimation = (minOpacity = 0.4, maxOpacity = 1) => {
  const opacity = useRef(new Animated.Value(maxOpacity)).current;

  const startPulse = useCallback(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: minOpacity,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: maxOpacity,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return animation;
  }, [opacity, minOpacity, maxOpacity]);

  const stopPulse = useCallback(() => {
    opacity.setValue(maxOpacity);
  }, [opacity, maxOpacity]);

  return {
    opacity,
    startPulse,
    stopPulse,
    style: { opacity },
  };
};
