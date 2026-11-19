import { compress, decompress } from "./codec.mjs";
import { mountEncoding } from "./encoding.mjs";
import { get, number } from "./ui.mjs";

const preset = get("preset");
const board = get("playground-stage");
const play = get("demo-play");
const step = get("demo-step");
const reset = get("demo-reset");
const archive = get("demo-archive");
let driver;

function loadExample() {
  driver?.dispose();
  const input = new TextEncoder().encode(preset.value);
  const result = compress(input);
  const decoded = decompress(result.output).output;
  const exact = decoded.length === input.length && decoded.every((byte, i) => byte === input[i]);
  const codes = new Map(result.rows.map((row) => [row.symbol, row.bits]));
  driver = mountEncoding(board, input, codes, ({ cursor, total, playing, bitCount, written }) => {
    get("demo-play-icon").dataset.state = playing ? "pause" : cursor === total ? "replay" : "play";
    get("demo-play-label").textContent = playing ? "Pause" : cursor === total ? "Replay encoding" : "Play encoding";
    step.disabled = playing || cursor === total;
    reset.disabled = cursor === 0;
    get("demo-size").style.width = `${100 * bitCount / (input.length * 8)}%`;
    get("demo-written").style.width = `${100 * written / (input.length * 8)}%`;
    const payload = `${number.format(input.length * 8)} → ${number.format(bitCount)} bits`;
    archive.textContent = cursor === total
      ? `${payload} before headers · ${result.output.length} B archive · ${exact ? "Byte match" : "Restore failed"}`
      : `${payload} before headers`;
  });
}

preset.addEventListener("change", loadExample);
play.addEventListener("click", () => driver.playing ? driver.pause() : driver.play());
step.addEventListener("click", () => driver.next());
reset.addEventListener("click", () => driver.reset());
window.addEventListener("pagehide", () => driver?.pause());
loadExample();
