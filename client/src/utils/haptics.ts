// Haptics for Petals chat reactions. Guarded everywhere: on web, or
// when the native plugin is unavailable, these are no-ops (with a
// navigator.vibrate fallback on Android web where it exists). They must
// never throw, and never block a tap, send, or reaction.
import { Capacitor } from '@capacitor/core';

type Impact = 'light' | 'medium' | 'heavy';

async function impact(style: Impact): Promise<void> {
  try {
    if (!Capacitor.isNativePlatform()) {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(style === 'heavy' ? 25 : style === 'medium' ? 15 : 8);
      }
      return;
    }
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({
      style: style === 'light' ? ImpactStyle.Light : style === 'medium' ? ImpactStyle.Medium : ImpactStyle.Heavy,
    });
  } catch {
    // Haptics are a nice-to-have. Never fail the action that triggered them.
  }
}

export async function hapticLight(): Promise<void> {
  await impact('light');
}

export async function hapticMedium(): Promise<void> {
  await impact('medium');
}

export async function hapticHeavy(): Promise<void> {
  await impact('heavy');
}

export async function hapticSelection(): Promise<void> {
  try {
    if (!Capacitor.isNativePlatform()) {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(5);
      return;
    }
    const { Haptics } = await import('@capacitor/haptics');
    await Haptics.selectionStart();
    await Haptics.selectionChanged();
    await Haptics.selectionEnd();
  } catch {
    // Ignore, see above.
  }
}

export async function hapticSuccess(): Promise<void> {
  try {
    if (!Capacitor.isNativePlatform()) {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate([8, 30, 8]);
      return;
    }
    const { Haptics, NotificationType } = await import('@capacitor/haptics');
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    // Ignore, see above.
  }
}
