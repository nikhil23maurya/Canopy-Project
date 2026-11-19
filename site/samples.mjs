const encoder = new TextEncoder();

function deviceLogs() {
  return encoder.encode(Array.from({ length: 720 }, (_, index) => {
    const minute = String(Math.floor(index / 60)).padStart(2, "0");
    const second = String(index % 60).padStart(2, "0");
    const mode = index % 32 === 0 ? "WARN retry=1" : "INFO state=ready";
    const device = String(index % 8 + 1).padStart(2, "0");
    return `2026-11-17T09:${minute}:${second}Z device=${device} ${mode} voltage_mv=${3290 + index % 31}\n`;
  }).join(""));
}

function telemetry() {
  return encoder.encode("id,temperature_c,pressure_kpa,enabled\n" +
    Array.from({ length: 1100 }, (_, i) => `${i},${(19 + (i % 83) / 10).toFixed(1)},${(100 + (i % 19) / 10).toFixed(1)},${i % 5 !== 0}\n`).join(""));
}

function pseudoRandom(size) {
  const out = new Uint8Array(size);
  let value = 0x42a8b31d;
  for (let i = 0; i < out.length; i++) {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    out[i] = value & 255;
  }
  return out;
}

export const samples = [
  { id: "logs", label: "Device logs", name: "device-logs.txt", description: "720 timestamped records with recurring fields", bytes: deviceLogs },
  { id: "telemetry", label: "Telemetry CSV", name: "telemetry.csv", description: "1,100 records with repeated numeric fields", bytes: telemetry },
  { id: "binary", label: "Uniform binary", name: "uniform.bin", description: "64 KiB of seeded pseudorandom bytes", bytes: () => pseudoRandom(65_536) },
  { id: "tiny", label: "Tiny text", name: "tiny.txt", description: "A 12-byte text file", bytes: () => encoder.encode("BANANA_BANAN") },
  { id: "packed", label: "Already compressed", name: "device-logs.txt.gz", description: "The device log fixture compressed with GZIP", bytes: async () => {
    const response = await fetch("/assets/device-logs.txt.gz");
    if (!response.ok) throw Error("Could not load the GZIP sample.");
    return new Uint8Array(await response.arrayBuffer());
  } },
];
