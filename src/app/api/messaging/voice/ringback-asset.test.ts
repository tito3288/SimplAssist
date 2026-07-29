import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SAMPLE_RATE = 8_000;
const BYTES_PER_SAMPLE = 2;
const DATA_OFFSET = 44;
const ASSET_PATH = resolve(
  process.cwd(),
  "public/audio/voicemail-ringback-11s-v1.wav"
);

function readSamples(wav: Buffer): Int16Array {
  const sampleCount = wav.readUInt32LE(40) / BYTES_PER_SAMPLE;
  const samples = new Int16Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = wav.readInt16LE(
      DATA_OFFSET + index * BYTES_PER_SAMPLE
    );
  }
  return samples;
}

function sampleWindow(
  samples: Int16Array,
  startSeconds: number,
  endSeconds: number
): Int16Array {
  return samples.slice(
    startSeconds * SAMPLE_RATE,
    endSeconds * SAMPLE_RATE
  );
}

describe("voicemail ringback audio asset", () => {
  it("is the deterministic 11.2-second mono PCM WAV", () => {
    const wav = readFileSync(ASSET_PATH);

    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(179_200);
    expect(wav.length).toBe(179_244);
    expect(wav.readUInt32LE(40) / BYTES_PER_SAMPLE / SAMPLE_RATE).toBe(
      11.2
    );
    expect(createHash("sha256").update(wav).digest("hex")).toBe(
      "6134cd8af7c06e6ec43febf53f60682a9fc644ca6e8d9c04e7943de3f848cce0"
    );
  });

  it("contains three ring bursts followed by the 1.2-second stop-gap", () => {
    const samples = readSamples(readFileSync(ASSET_PATH));

    for (const [start, end] of [
      [0, 2],
      [4, 6],
      [8, 10],
    ]) {
      const tone = sampleWindow(samples, start, end);
      expect(
        tone.reduce((maximum, sample) => Math.max(maximum, sample), 0)
      ).toBeGreaterThan(5_000);
      expect(
        tone.reduce((minimum, sample) => Math.min(minimum, sample), 0)
      ).toBeLessThan(-5_000);
    }

    for (const [start, end] of [
      [2, 4],
      [6, 8],
      [10, 11.2],
    ]) {
      expect(
        sampleWindow(samples, start, end).every((sample) => sample === 0)
      ).toBe(true);
    }

    expect(sampleWindow(samples, 10, 11.2).length).toBe(
      1.2 * SAMPLE_RATE
    );
  });
});
