'use client';

import { useCallback, useRef, useState } from 'react';
import {
  calculateVoiceLevels,
  calculateVoiceVolume,
  createEmptyVoiceLevels,
} from './utils';

export function useVoiceMeter() {
  const [voiceLevels, setVoiceLevels] = useState<number[]>(() => createEmptyVoiceLevels());
  const [voiceVolume, setVoiceVolume] = useState(0);
  const voiceMeterAudioContextRef = useRef<AudioContext | null>(null);
  const voiceMeterAnimationRef = useRef<number | null>(null);

  const stopVoiceMeter = useCallback(() => {
    if (voiceMeterAnimationRef.current !== null) {
      window.cancelAnimationFrame(voiceMeterAnimationRef.current);
      voiceMeterAnimationRef.current = null;
    }

    void voiceMeterAudioContextRef.current?.close();
    voiceMeterAudioContextRef.current = null;
    setVoiceLevels(createEmptyVoiceLevels());
    setVoiceVolume(0);
  }, []);

  const startVoiceMeter = useCallback(
    (stream: MediaStream) => {
      stopVoiceMeter();

      try {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.82;
        source.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        voiceMeterAudioContextRef.current = audioContext;

        const animate = () => {
          analyser.getByteFrequencyData(data);
          const nextLevels = calculateVoiceLevels(data);

          setVoiceLevels(nextLevels);
          setVoiceVolume(calculateVoiceVolume(nextLevels));
          voiceMeterAnimationRef.current = window.requestAnimationFrame(animate);
        };

        voiceMeterAnimationRef.current = window.requestAnimationFrame(animate);
      } catch {
        setVoiceLevels(createEmptyVoiceLevels());
        setVoiceVolume(0);
      }
    },
    [stopVoiceMeter],
  );

  return {
    voiceLevels,
    voiceVolume,
    startVoiceMeter,
    stopVoiceMeter,
  };
}
