import { compress, MAX_BYTES } from "./codec.mjs";
import { samples } from "./samples.mjs";
import { bytes, element, get, startWorker } from "./ui.mjs";

const input = get("file-input");
const picker = get("pick-button");
const drop = get("drop-zone");
const error = get("error");
const progress = get("progress");
const download = get("download");
const restoreCurrent = get("restore-current");
const filesAtOnce = "Choose one file at a time.";

const copy = {
  compress: {
    heading: "Compress a file",
    description: "Make a file smaller for storage or sharing.",
    drop: "Drop your file here",
    limit: "One file up to 24 MiB",
    picker: "Choose file",
    sample: "Try a sample file",
    busy: "Compressing your file…",
  },
  restore: {
    heading: "Restore a file",
    description: "Open a Canopy archive to get your original file back.",
    drop: "Drop your archive here",
    limit: "Choose a .huf archive",
    picker: "Choose archive",
    sample: "Try a sample archive",
    busy: "Restoring your file…",
  },
};

let mode;
let work;
let archive;
let outputURL;

function updateView(view) {
  for (const name of ["pick", "busy", "result"]) get(`${name}-view`).hidden = name !== view;
}

function clearOutput() {
  archive = undefined;
  if (outputURL) URL.revokeObjectURL(outputURL);
  outputURL = undefined;
  download.removeAttribute("href");
}

function setError(message = "") {
  error.textContent = message;
  error.hidden = !message;
}

function stopWork() {
  work?.abort.abort();
  work = undefined;
}

function chooseMode(next, { push = false, focus = false } = {}) {
  stopWork();
  clearOutput();
  mode = next;
  document.body.dataset.mode = mode;
  const text = copy[mode];
  document.title = text.heading + " · Canopy";
  get("page-title").textContent = text.heading;
  get("page-description").textContent = text.description;
  get("drop-label").textContent = text.drop;
  get("file-limit").textContent = text.limit;
  get("pick-label").textContent = text.picker;
  get("sample").textContent = text.sample;
  input.accept = mode === "restore" ? ".huf,.huff,application/octet-stream" : "";
  for (const link of document.querySelectorAll("nav [data-switch]")) {
    if (link.dataset.switch === mode) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  setError();
  get("status").textContent = "";
  updateView("pick");
  if (push) history.pushState({ mode }, "", mode === "restore" ? "/restore/" : "/");
  if (focus) picker.focus();
}

function normalizeError(problem, operation) {
  const message = problem.message || "";
  if (operation === "restore") {
    if (message.includes("24 MiB")) return "This archive expands beyond the file size limit.";
    if (/worker|browser|network|fetch/i.test(message)) return "Couldn’t read the archive. Try choosing it again.";
    return "Couldn’t restore this file. Choose an intact .huf archive made with Canopy or Huffman Studio.";
  }
  return "Couldn’t compress this file. Try choosing it again.";
}

function beginBusy(name) {
  setError();
  clearOutput();
  updateView("busy");
  get("busy-title").textContent = copy[mode].busy;
  get("busy-filename").textContent = name;
  get("status").textContent = copy[mode].busy;
  progress.removeAttribute("value");
}

function cancel() {
  stopWork();
  updateView("pick");
  get("status").textContent = "Operation cancelled.";
  picker.focus();
}

function sizeCard(label, value, max) {
  const card = element("div", undefined, "size-card");
  const track = element("div", undefined, "size-track");
  track.setAttribute("aria-hidden", "true");
  const bar = element("i");
  bar.style.width = `${100 * value / Math.max(1, max)}%`;
  track.append(bar);
  card.append(element("span", label), element("strong", bytes(value)), track);
  return card;
}

function renderResult(source, output) {
  const compressing = mode === "compress";
  const size = output.length;
  const name = compressing
    ? source.name + ".huf"
    : source.name.replace(/\.huff?$/i, "") !== source.name
      ? source.name.replace(/\.huff?$/i, "") || "restored-file"
      : source.name + ".restored";
  const blob = new Blob([output], { type: "application/octet-stream" });
  outputURL = URL.createObjectURL(blob);
  download.href = outputURL;
  download.download = name;
  archive = compressing ? new File([blob], name) : undefined;
  restoreCurrent.hidden = !archive;

  const savings = source.size ? (1 - size / source.size) * 100 : 0;
  const detail = get("result-detail");
  detail.classList.toggle("notice", compressing && savings < 0);
  const heading = !compressing ? "File restored" : savings > 0 ? `${savings.toFixed(1)}% smaller` : "Archive created";
  get("result-heading").textContent = heading;
  get("result-filename").textContent = name;
  get("download-label").textContent = compressing ? "Download archive" : "Download restored file";

  const maximum = Math.max(size, source.size);
  const cards = compressing
    ? [sizeCard("Original size", source.size, maximum), sizeCard("Archive size", size, maximum)]
    : [sizeCard("Restored size", size, maximum)];
  get("sizes").replaceChildren(...cards);
  get("sizes").classList.toggle("is-single", !compressing);

  detail.textContent = !compressing ? "Your original file is ready to download."
    : !source.size ? "This empty file produces a small archive that can be restored."
    : savings < 0 ? "This archive is larger. Keep the original if you want the smaller file."
      : savings === 0 ? "This file and its archive are the same size."
        : "Download the archive to save or share it. Use Restore to open it again.";

  updateView("result");
  get("status").textContent = heading + ". " + detail.textContent;
  download.focus({ preventScroll: true });
}

async function transfer(task, source) {
  if (work !== task) return;
  const limit = task.mode === "restore" ? MAX_BYTES + 530 : MAX_BYTES;
  if (source.size > limit) {
    work = undefined;
    updateView("pick");
    setError("Choose a file up to 24 MiB.");
    return;
  }
  get("busy-filename").textContent = source.name;
  try {
    const buffer = await source.arrayBuffer();
    if (work !== task) return;
    const { result } = await startWorker(task.mode === "restore" ? "decompress" : "compress", buffer, (fraction) => {
      if (work === task) progress.value = Math.round(fraction * 100);
    }, task.abort.signal);
    if (work !== task) return;
    renderResult(source, result.output);
  } catch (problem) {
    if (work !== task) return;
    updateView("pick");
    setError(normalizeError(problem, task.mode));
    picker.focus();
  } finally {
    if (work === task) work = undefined;
  }
}

function startFile(file) {
  if (work || !file) return;
  const task = { mode, abort: new AbortController() };
  work = task;
  beginBusy(file.name);
  transfer(task, file);
}

async function loadSample(id = "logs") {
  if (work) return;
  const fixture = samples.find((sample) => sample.id === id);
  if (!fixture) return;
  const task = { mode, abort: new AbortController() };
  work = task;
  const name = task.mode === "restore" ? fixture.name + ".huf" : fixture.name;
  beginBusy(name);
  try {
    const original = await fixture.bytes();
    if (work !== task) return;
    const content = task.mode === "restore" ? compress(original).output : original;
    await transfer(task, new File([content], name));
  } catch {
    if (work !== task) return;
    work = undefined;
    updateView("pick");
    setError("The sample is unavailable. You can still choose your own file.");
  }
}

picker.addEventListener("click", () => input.click());
input.addEventListener("change", () => {
  const file = input.files[0];
  input.value = "";
  startFile(file);
});
get("sample").addEventListener("click", () => loadSample());
get("cancel").addEventListener("click", cancel);
restoreCurrent.addEventListener("click", () => {
  if (!archive || work) return;
  const current = archive;
  chooseMode("restore", { push: true });
  startFile(current);
});
get("another").addEventListener("click", () => {
  chooseMode(mode, { focus: true });
  input.click();
});

for (const name of ["dragenter", "dragover"]) drop.addEventListener(name, (event) => {
  event.preventDefault();
  if (event.dataTransfer.types.includes("Files")) drop.classList.add("dragging");
});
drop.addEventListener("dragleave", (event) => {
  if (!drop.contains(event.relatedTarget)) drop.classList.remove("dragging");
});
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("dragging");
  const files = event.dataTransfer.files;
  if (files.length > 1) setError(filesAtOnce);
  else startFile(files[0]);
});
for (const type of ["dragover","drop"]) document.addEventListener(type, (event) => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});
for (const link of document.querySelectorAll("[data-switch]")) {
  link.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    const next = link.dataset.switch;
    if (next !== mode) chooseMode(next, { push: true, focus: true });
  });
}

window.addEventListener("popstate", (event) => chooseMode(event.state?.mode ??
  (/^\/(restore\/?|decompress\.html)$/.test(location.pathname) ? "restore" : "compress")));

chooseMode(document.body.dataset.mode);
history.replaceState({ mode }, "");
const sampleId = new URLSearchParams(location.search).get("sample");
if (sampleId) loadSample(sampleId);
