import React, { useEffect, useRef } from 'react';

interface VoiceVisualizerProps {
  mode: 'listening' | 'speaking' | 'thinking' | 'idle';
  audioContext?: AudioContext | null;
  sourceStream?: MediaStream | null;
  outputAnalyser?: AnalyserNode | null;
}

const VoiceVisualizer: React.FC<VoiceVisualizerProps> = ({
  mode,
  audioContext,
  sourceStream,
  outputAnalyser
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    if (mode === 'listening' && sourceStream && audioContext) {
      if (!inputAnalyserRef.current) {
        try {
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          const source = audioContext.createMediaStreamSource(sourceStream);
          source.connect(analyser);
          inputAnalyserRef.current = analyser;
          inputSourceRef.current = source;
        } catch (e) {
          console.error('Error setting up input visualizer:', e);
        }
      }
    }

    return () => {
      if (mode !== 'listening') {
        inputSourceRef.current?.disconnect();
        inputSourceRef.current = null;
        inputAnalyserRef.current = null;
      }
    };
  }, [mode, sourceStream, audioContext]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const draw = () => {
      if (!canvas) return;
      const width = rect.width;
      const height = rect.height;

      ctx.clearRect(0, 0, width, height);

      if (mode === 'thinking') {
        const time = Date.now() / 1000;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        for (let x = 0; x < width; x++) {
          const y = Math.sin(x * 0.05 + time * 5) * 10 * Math.sin(time) + height / 2;
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
        animationRef.current = requestAnimationFrame(draw);
        return;
      }

      let analyserToUse: AnalyserNode | null = null;
      if (mode === 'listening') analyserToUse = inputAnalyserRef.current;
      else if (mode === 'speaking') analyserToUse = outputAnalyser || null;

      if (analyserToUse) {
        const bufferLength = analyserToUse.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserToUse.getByteFrequencyData(dataArray);

        const barWidth = (width / bufferLength) * 2.5;
        let x = 0;
        const centerY = height / 2;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = Math.pow(dataArray[i] / 255, 1.5) * (height * 0.8);
          ctx.fillStyle = `rgba(56, 189, 248, ${Math.min(1, dataArray[i] / 200 + 0.2)})`;
          ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight);
          x += barWidth + 1;
        }
      } else {
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [mode, outputAnalyser]);

  return (
    <div className="w-full h-16 flex items-center justify-center bg-slate-50 dark:bg-slate-800/50 rounded-lg overflow-hidden border border-slate-100 dark:border-slate-700">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
};

export default VoiceVisualizer;
