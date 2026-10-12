import type { CanonizerRenderPlan } from "@forever-jukebox/shared/autocanonizer/canonizerRenderPlan";
import { clampGain, createOutputBuffer } from "./render";

// Output seconds mixed between yields to the event loop.
const MIX_SLICE_SECONDS = 30;

// Mixes the planned canon voices from the source into a stereo buffer.
export async function renderCanonizerAudio(
  sourceBuffer: AudioBuffer,
  plan: CanonizerRenderPlan,
  options: { gain?: number; onProgress?: (progress: number) => void } = {},
): Promise<AudioBuffer> {
  const sampleRate = sourceBuffer.sampleRate;
  const output = createOutputBuffer(
    2,
    Math.round(plan.durationSeconds * sampleRate),
    sampleRate,
  );
  const volume = clampGain(options.gain ?? 1);
  const sourceLeft = sourceBuffer.getChannelData(0);
  const sourceRight = sourceBuffer.getChannelData(
    Math.min(1, sourceBuffer.numberOfChannels - 1),
  );
  const outLeft = output.getChannelData(0);
  const outRight = output.getChannelData(1);
  const voices = plan.voices.map((voice) => {
    // Stereo-input law of a StereoPannerNode.
    const pan = Math.max(-1, Math.min(1, voice.pan));
    const angle = ((pan <= 0 ? pan + 1 : pan) * Math.PI) / 2;
    return {
      segments: voice.segments,
      leftToLeft: pan <= 0 ? 1 : Math.cos(angle),
      rightToLeft: pan <= 0 ? Math.cos(angle) : 0,
      leftToRight: pan <= 0 ? 0 : Math.sin(angle),
      rightToRight: pan <= 0 ? Math.sin(angle) : 1,
    };
  });

  const sliceFrames = MIX_SLICE_SECONDS * sampleRate;
  for (let slice = 0; slice < output.length; slice += sliceFrames) {
    const sliceEnd = Math.min(output.length, slice + sliceFrames);
    for (const voice of voices) {
      for (const segment of voice.segments) {
        const shift = Math.round(segment.sourceOffset * sampleRate);
        const gain = segment.gain * volume;
        // Frames with no source audio behind them stay silent.
        const first = Math.max(
          slice,
          Math.round(segment.outputStart * sampleRate),
          -shift,
        );
        const end = Math.min(
          sliceEnd,
          Math.round((segment.outputStart + segment.duration) * sampleRate),
          sourceBuffer.length - shift,
        );
        for (let frame = first; frame < end; frame += 1) {
          const left = (sourceLeft[frame + shift] as number) * gain;
          const right = (sourceRight[frame + shift] as number) * gain;
          outLeft[frame] =
            (outLeft[frame] as number) +
            left * voice.leftToLeft +
            right * voice.rightToLeft;
          outRight[frame] =
            (outRight[frame] as number) +
            left * voice.leftToRight +
            right * voice.rightToRight;
        }
      }
    }
    options.onProgress?.(sliceEnd / output.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return output;
}
