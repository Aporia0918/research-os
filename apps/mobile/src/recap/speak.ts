import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

/** Read text aloud with the phone's own voice; 'none' when the phone has no voice for the language. */
export async function speak(text: string, lang: 'zh-CN' | 'en-US'): Promise<'done' | 'none'> {
  if (!Capacitor.isNativePlatform()) return 'none';
  const { supported } = await TextToSpeech.isLanguageSupported({ lang });
  if (!supported) return 'none';
  await TextToSpeech.speak({ text, lang, rate: 1.0, pitch: 1.0, volume: 1.0 });
  return 'done';
}
export async function stopSpeaking(): Promise<void> { if (Capacitor.isNativePlatform()) await TextToSpeech.stop(); }
