import { mountEncoding } from "./encoding.mjs";
import { compress, MAX_BYTES } from "./codec.mjs";
import { samples } from "./samples.mjs";
import { get, bytes, byteLabel, number, element, reducedMotion, startWorker } from "./ui.mjs";

const fileInput = get("file");
const drop = get("drop");
const sampleSelect = get("sample");
const runButton = get("run");
const progress = get("job-progress");
const status = get("job-status");
const visual = get("trace-visual");
const initialVisual = visual.firstElementChild.cloneNode(true);
const phases = Array.from(get("phase-list").children);
const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
const names = {
  compress: ["Count", "Encode", "Pack", "Archive"],
  decompress: ["Read", "Decode", "Verify", "Restore"],
};

let mode = "compress";
let selected;
let controller;
let selectionId = 0;
let latest;
let archive;
let outputUrl;
let activePhase = -1;
let timer;
let encodingDriver;

const phaseButtons = phases.map((phase, index) => {
  const button = element("button");
  button.type = "button";
  button.disabled = true;
  button.append(...phase.childNodes);
  phase.append(button);
  button.addEventListener("click", () => {
    stopPlayback();
    showPhase(index);
  });
  return button;
});

for (const sample of samples) {
  const option = element("option", sample.label);
  option.value = sample.id;
  sampleSelect.append(option);
}

function setStatus(message, error = false) {
  status.classList.toggle("error", error);
  status.textContent = message;
}

function toggleBusy(busy) {
  for (const control of [drop, sampleSelect, ...modeButtons]) control.disabled = busy;
  runButton.disabled = busy || !selected;
  get("cancel").hidden = !busy;
  progress.hidden = !busy;
}

function setMode(nextMode) {
  if (controller || nextMode === mode) return;
  mode = nextMode;
  ++selectionId;
  for (const button of modeButtons) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  fileInput.accept = mode === "compress" ? "" : ".huf,application/octet-stream";
  get("run-label").textContent = mode === "compress" ? "Compress file" : "Restore file";
  get("trace-title").textContent = mode === "compress" ? "Inside the algorithm" : "Inside restoration";
  sampleSelect.value = "";
  setFile(undefined);
}

function selectFile(file) {
  if (controller) return;
  ++selectionId;
  sampleSelect.value = "";
  const maximum = mode === "compress" ? MAX_BYTES : MAX_BYTES + 530;
  if (file.size > maximum) {
    setFile(undefined);
    setStatus(mode === "compress" ? "Choose a file up to 24 MiB." : "Choose an archive up to 24 MiB plus HUF1 metadata.", true);
    return;
  }
  setFile(file);
}

function setFile(file) {
  selected = file;
  clearOutput();
  toggleBusy(false);
  get("file-title").textContent = file?.name ?? "Drop a file or browse";
  get("file-description").textContent = file
    ? `${bytes(file.size)} · Click to replace`
    : (mode === "compress" ? "Any file type" : "HUF1 archives (.huf)");
  setStatus(file ? "Ready to process." : "Waiting for a file.");
}

async function loadSample(id, autorun = false) {
  if (controller) return;
  const sample = samples.find((item) => item.id === id);
  const ticket = ++selectionId;
  if (!sample) { setFile(undefined); return; }
  sampleSelect.value = id;
  setFile(undefined);
  setStatus("Loading sample…");
  try {
    const data = await sample.bytes();
    if (ticket !== selectionId || controller) return;
    const blob = mode === "compress" ? data : compress(data).output;
    const name = mode === "compress" ? sample.name : `${sample.name}.huf`;
    setFile(new File([blob], name));
    if (autorun) await runFile();
  } catch (error) {
    if (ticket === selectionId) setStatus(error.message, true);
  }
}

function clearOutput() {
  stopPlayback();
  encodingDriver?.dispose();
  encodingDriver = undefined;
  latest = undefined;
  runButton.hidden = false;
  archive = undefined;
  activePhase = -1;
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = undefined;
  get("download").removeAttribute("href");
  get("result").hidden = true;
  get("codebook").hidden = true;
  get("codebook").open = false;
  get("replay").hidden = true;
  get("trace-controls").hidden = true;
  get("trace-caption").textContent = mode === "compress"
    ? "Inspect the codes and bitstream produced by your file."
    : "Follow a HUF1 archive back to the original bytes.";
  updatePhases(-1);
  visual.replaceChildren(initialVisual.cloneNode(true));
  const empty = visual.firstElementChild;
  if (mode === "decompress") {
    empty.querySelector("strong").textContent = "Restore an archive to see its transformation";
    empty.querySelector("p").textContent = "Code lengths, restored bytes and checksum verification show up here.";
  }
}

function updatePhases(index) {
  phases.forEach((node, i) => {
    node.classList.toggle("active", index === i);
    node.classList.toggle("complete", i < index);
    const button = phaseButtons[i];
    button.disabled = !latest;
    if (index === i) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
    button.replaceChildren(element("span", i < index ? "✓" : String(i + 1)), document.createTextNode(names[mode][i]));
  });
}

async function runFile() {
  if (!selected || controller) return;
  const source = selected;
  const operation = mode;
  const job = new AbortController();
  clearOutput();
  controller = job;
  toggleBusy(true);
  progress.value = 0;
  setStatus("Reading file…");
  try {
    const buffer = await source.arrayBuffer();
    const message = await startWorker(operation, buffer, (fraction, label) => {
      progress.value = Math.round(fraction * 100);
      setStatus(`${label}…`);
      const stage = operation === "compress" ? (fraction < .29 ? 0 : fraction < .42 ? 1 : 2) : (fraction < .31 ? 0 : fraction < .92 ? 1 : 2);
      updatePhases(stage);
      if (visual.querySelector("strong")?.textContent !== label) {
        const box = stageBox(label, "You can cancel while the file is processing.");
        visual.replaceChildren(box);
      }
    }, job.signal);
    latest = { ...message, source, operation };
    renderResult();
    setStatus(operation === "compress" ? "Archive ready to download." : "Restoration complete. CRC32 verified.");
    if (reducedMotion.matches) showPhase(3);
    else playFrom(0);
  } catch (error) {
    clearOutput();
    if (error.name === "AbortError") setStatus("Operation cancelled.");
    else setStatus(error.message || "The file could not be processed.", true);
  } finally {
    controller = undefined;
    toggleBusy(false);
  }
}

function renderResult() {
  const { result, source, operation, elapsed } = latest;
  const isCompress = operation === "compress";
  const outputName = isCompress
    ? `${source.name}.huf`
    : source.name.toLowerCase().endsWith(".huf") ? source.name.slice(0, -4) || "restored.bin" : `${source.name}.restored`;
  const blob = new Blob([result.output], { type: "application/octet-stream" });
  outputUrl = URL.createObjectURL(blob);
  const link = get("download");
  link.href = outputUrl;
  link.download = outputName;
  archive = isCompress ? new File([blob], outputName) : undefined;
  get("restore").hidden = !archive;
  get("download-label").textContent = isCompress ? "Download .huf archive" : "Download restored file";
  get("result-note").textContent = outputName;
  const state = get("result-state");
  const saved = source.size ? (1 - result.output.length / source.size) * 100 : null;
  state.classList.toggle("growth", isCompress && (saved < 0 || saved === null));
  state.textContent = !isCompress ? "CRC32 verified" : saved === null ? "Header only" : saved < 0
    ? `${Math.abs(saved).toFixed(1)}% larger` : saved > 0 ? `${saved.toFixed(1)}% saved` : "Same size";
  const metrics = [
    [isCompress ? "Original size" : "Archive size", bytes(source.size)],
    [isCompress ? "Archive size" : "Restored size", bytes(result.output.length)],
    ["Header + codebook", bytes(result.headerBytes)],
    [isCompress ? "Compression time" : "Restore time", elapsed < 0.1 ? "<0.1 ms" : `${elapsed.toFixed(1)} ms`],
  ];
  get("result-metrics").replaceChildren(...metrics.map(([label, value]) => {
    const card = element("div");
    card.append(element("dt", label), element("dd", value));
    return card;
  }));
  runButton.hidden = true;
  get("result").hidden = false;
  get("trace-caption").textContent = "Replay the measured run or step through it at your own pace.";
  get("replay").hidden = false;
  get("trace-controls").hidden = false;
  if (result.rows?.length) {
    get("codebook-count").textContent = `${result.rows.length} byte values`;
    get("codebook-body").replaceChildren(...result.rows.map((row) => {
      const tr = element("tr");
      for (const value of [byteLabel(row.symbol), row.symbol, number.format(row.frequency), `${row.length} bits`]) tr.append(element("td", value));
      const td = element("td");
      td.append(element("code", row.bits));
      tr.append(td);
      return tr;
    }));
    get("codebook").hidden = false;
  }
}

function stageBox(title, detail) {
  const box = element("div", undefined, "trace-stage");
  box.append(element("strong", title), element("p", detail, "stage-text"));
  return box;
}

function tileLane(items) {
  const lane = element("div", undefined, "byte-lane");
  items.forEach(([label, note], index) => {
    const tile = element("span", label, "byte-tile");
    tile.style.setProperty("--order", index);
    if (note) tile.append(element("small", note));
    lane.append(tile);
  });
  return lane;
}

function packedBytes(result) {
  const row = element("div", undefined, "packed-bytes");
  const preview = result.output.subarray(result.headerBytes, result.headerBytes + 4);
  for (const [index, value] of preview.entries()) {
    const cell = element("div", undefined, "packed-byte");
    cell.style.setProperty("--order", index);
    const bits = value.toString(2).padStart(8, "0");
    const hex = "0x" + value.toString(16).toUpperCase().padStart(2, "0");
    cell.append(element("code", bits), element("span", "→"), element("strong", hex));
    row.append(cell);
  }
  return row;
}

function archiveBar(header, payload) {
  const key = element("div", undefined, "archive-key");
  key.append(element("span", `Header + codebook · ${bytes(header)}`), element("span", `Payload · ${bytes(payload)}`));
  const bar = element("div", undefined, "archive-bar");
  for (const value of [header, payload]) {
    const part = element("span");
    part.style.width = `${value / Math.max(header + payload, 1) * 100}%`;
    bar.append(part);
  }
  return [key, bar];
}

function compressionStage(index) {
  const { result, source, preview, lengths, crc } = latest;
  const payload = result.output.length - result.headerBytes;
  let box;
  if (index === 0) {
    box = stageBox(`${number.format(source.size)} bytes counted`, lengths
      ? `${lengths} distinct byte values. Showing the five most frequent.`
      : "Empty input has no byte values to count.");
    const frequency = element("div", undefined, "freq-list");
    for (const [order, row] of result.rows.slice(0, 5).entries()) {
      const track = element("span", undefined, "freq-track");
      const bar = element("span");
      bar.style.width = `${row.frequency / result.rows[0].frequency * 100}%`;
      bar.style.setProperty("--order", order);
      track.append(bar);
      const line = element("div", undefined, "freq-item");
      line.append(element("span", byteLabel(row.symbol)), track, element("span", number.format(row.frequency)));
      frequency.append(line);
    }
    box.append(frequency);
  } else if (index === 1) {
    box = stageBox(`${lengths} canonical codes assigned`, preview.length
      ? `Mapping the first ${preview.length} input bytes using this file’s codebook.`
      : "An empty file has no codebook.");
    if (preview.length) {
      const demo = element("div", undefined, "file-encoding");
      const controls = element("div", undefined, "inline-controls");
      const step = element("button", "Next byte", "button small outline");
      const play = element("button", "Play bytes", "button small quiet");
      for (const button of [step, play]) button.type = "button";
      controls.append(step, play);
      box.append(demo, controls);
      const lookup = new Map(result.rows.map((row) => [row.symbol, row.bits]));
      encodingDriver = mountEncoding(demo, preview, lookup, ({ cursor, total, playing }) => {
        step.disabled = playing || cursor === total;
        play.textContent = playing ? "Pause bytes" : cursor === total ? "Replay bytes" : "Play bytes";
      });
      step.addEventListener("click", () => encodingDriver?.next());
      play.addEventListener("click", () => encodingDriver?.playing ? encodingDriver.pause() : encodingDriver?.play());
    }
  } else if (index === 2) {
    const padding = payload * 8 - result.bitCount;
    box = stageBox(`${bytes(source.size)} → ${bytes(payload)} of payload`,
      `${number.format(result.bitCount)} encoded bits and ${padding} padding bits. The archive adds its header and codebook next.`);
    if (payload) box.append(packedBytes(result));
  } else {
    box = stageBox(`${bytes(result.output.length)} total archive`,
      `CRC32 ${crc.toString(16).toUpperCase().padStart(8, "0")} is stored for verification when the archive is restored.`);
    box.append(...archiveBar(result.headerBytes, payload));
  }
  return box;
}

function restoreStage(index) {
  const { result, source, preview, lengths, crc } = latest;
  if (index === 0) {
    const box = stageBox(`${bytes(source.size)} HUF1 archive`, `Rebuild the canonical codebook from ${lengths} stored code lengths.`);
    box.append(...archiveBar(result.headerBytes, source.size - result.headerBytes));
    return box;
  }
  if (index === 1) {
    const box = stageBox(`${number.format(result.bitCount)} bits decoded`, preview.length
      ? `The prefix codes recover ${number.format(result.output.length)} bytes. Shown here are the first ${preview.length}.`
      : "The archive contains an empty file.");
    box.append(tileLane(preview.map((byte) => [byteLabel(byte)])));
    return box;
  }
  if (index === 2) return stageBox("CRC32 matched", `The restored bytes match the archive checksum ${crc.toString(16).toUpperCase().padStart(8, "0")}.`);
  return stageBox(`${bytes(result.output.length)} restored`, "The original byte stream is ready to download.");
}

function stopPlayback() {
  clearTimeout(timer);
  timer = undefined;
  encodingDriver?.pause();
  get("pause-phase").textContent = "Play stages";
}

function showPhase(index) {
  if (!latest) return;
  encodingDriver?.dispose();
  encodingDriver = undefined;
  activePhase = index;
  updatePhases(index);
  visual.replaceChildren(latest.operation === "compress" ? compressionStage(index) : restoreStage(index));
  get("phase-position").textContent = `Stage ${index + 1} of ${phases.length}`;
  get("prev-phase").disabled = index === 0;
  get("next-phase").disabled = index === phases.length - 1;
}

function playFrom(index) {
  stopPlayback();
  showPhase(index);
  if (index >= phases.length - 1) return;
  get("pause-phase").textContent = "Pause playback";
  encodingDriver?.play();
  const delay = encodingDriver ? Math.max(1900, latest.preview.length * 550 + 550) : [1050, 1700, 1650][index];
  timer = setTimeout(() => playFrom(index + 1), delay);
}

for (const button of modeButtons) button.addEventListener("click", () => setMode(button.dataset.mode));
drop.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) selectFile(fileInput.files[0]);
  fileInput.value = "";
});
for (const event of ["dragenter", "dragover"]) drop.addEventListener(event, (e) => {
  e.preventDefault();
  if (!controller) drop.classList.add("drag");
});
drop.addEventListener("dragleave", (event) => {
  if (!drop.contains(event.relatedTarget)) drop.classList.remove("drag");
});
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("drag");
  if (event.dataTransfer.files[0]) selectFile(event.dataTransfer.files[0]);
});
for (const type of ["dragover", "drop"]) document.addEventListener(type, (event) => {
  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
});
sampleSelect.addEventListener("change", () => loadSample(sampleSelect.value));
runButton.addEventListener("click", runFile);
get("cancel").addEventListener("click", () => controller?.abort());
get("restore").addEventListener("click", () => {
  if (!archive || controller) return;
  const inputArchive = archive;
  setMode("decompress");
  setFile(inputArchive);
  runFile();
});
get("replay").addEventListener("click", () => playFrom(0));
get("pause-phase").addEventListener("click", () => {
  if (timer) stopPlayback();
  else playFrom(activePhase === phases.length - 1 ? 0 : activePhase);
});
get("prev-phase").addEventListener("click", () => { stopPlayback(); showPhase(activePhase - 1); });
get("next-phase").addEventListener("click", () => { stopPlayback(); showPhase(activePhase + 1); });

const params = new URLSearchParams(location.search);
if (params.has("sample")) loadSample(params.get("sample"), params.get("run") === "1");
