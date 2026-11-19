import { compress, decompress } from "./codec.mjs";

self.onmessage = ({ data: { mode, buffer } }) => {
  const began = performance.now();
  const report = (value, label) => self.postMessage({ type: "progress", value, label });
  try {
    const data = new Uint8Array(buffer);
    if (mode === "benchmark") {
      const { output } = compress(data);
      const restored = decompress(output).output;
      const exact = restored.length === data.length && restored.every((byte, index) => byte === data[index]);
      self.postMessage({ type: "done", inputSize: data.length, archiveSize: output.length, exact });
      return;
    }
    report(0.12, mode === "compress" ? "Counting byte frequencies" : "Reading the archive header");
    const compressing = mode === "compress";
    const result = compressing ? compress(data, report) : decompress(data, report);
    const archive = compressing ? result.output : data;
    const crc = new DataView(archive.buffer, archive.byteOffset, archive.byteLength).getUint32(14);
    const preview = Array.from((compressing ? data : result.output).subarray(0, 12));
    const lengths = compressing ? result.rows.length : (result.headerBytes - 18) / 2;
    self.postMessage({ type: "done", result, elapsed: performance.now() - began, preview, crc, lengths }, [result.output.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};
