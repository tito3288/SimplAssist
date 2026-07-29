import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const sampleRate = 8_000;
const toneLengthFrames = 2 * sampleRate;
const totalFrames = 89_600;
const bitsPerSample = 16;
const channelCount = 1;
const bytesPerSample = bitsPerSample / 8;
const dataByteLength = totalFrames * channelCount * bytesPerSample;
const outputPath = resolve(
  "public/audio/voicemail-ringback-11s-v1.wav"
);
const toneStarts = [0, 4 * sampleRate, 8 * sampleRate];
const fadeFrames = 40;
const perTonePeak = 0.125;

const wav = Buffer.alloc(44 + dataByteLength);
wav.write("RIFF", 0, "ascii");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVE", 8, "ascii");
wav.write("fmt ", 12, "ascii");
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(channelCount, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
wav.writeUInt16LE(channelCount * bytesPerSample, 32);
wav.writeUInt16LE(bitsPerSample, 34);
wav.write("data", 36, "ascii");
wav.writeUInt32LE(dataByteLength, 40);

for (const toneStart of toneStarts) {
  for (let frame = 0; frame < toneLengthFrames; frame += 1) {
    const edge = Math.min(frame, toneLengthFrames - 1 - frame);
    const envelope =
      edge >= fadeFrames
        ? 1
        : 0.5 - 0.5 * Math.cos((Math.PI * edge) / fadeFrames);
    const sample = Math.round(
      32_767 *
        perTonePeak *
        envelope *
        (Math.sin((2 * Math.PI * 440 * frame) / sampleRate) +
          Math.sin((2 * Math.PI * 480 * frame) / sampleRate))
    );
    wav.writeInt16LE(
      sample,
      44 + (toneStart + frame) * bytesPerSample
    );
  }
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, wav);
console.log(`Generated ${outputPath} (${totalFrames / sampleRate}s)`);
