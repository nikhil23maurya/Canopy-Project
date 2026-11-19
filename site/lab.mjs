import { canonical, codeLengths, compress, decompress, makeTree } from "./codec.mjs";
import { byteLabel, element, get, number, reducedMotion } from "./ui.mjs";

const treeView = get("tree");
const input = get("lab-input");
const queue = get("queue");
const scrub = get("lab-scrub");
const encodePanel = get("encode-panel");
const sourceChips = get("source-chips");
const bitChips = get("bits-chips");
const decodedChips = get("decoded-chips");
const decodeButton = get("decode");
const byWeight = (a, b) => a.weight - b.weight || a.minimum - b.minimum;
const label = (node) => node.symbol === undefined ? "Subtree" : byteLabel(node.symbol);

let inputBytes;
let codebook;
let trace = [];
let step = 0;
let playTimer;
let decodeTimer;
let decoded;
let decodeIndex = 0;

function buildTree() {
  const bytes = new TextEncoder().encode(input.value);
  const freq = new Uint32Array(256);
  for (const byte of bytes) freq[byte]++;
  const leaves = Array.from(freq.entries()).filter(([, weight]) => weight)
    .map(([symbol, weight]) => ({ symbol, weight, minimum: symbol, id: symbol }))
    .sort(byWeight);
  const status = get("lab-error");
  if (leaves.length === 0 || leaves.length > 18) {
    status.classList.add("error");
    status.textContent = leaves.length === 0 ? "Enter at least one byte." : "Choose text with at most 18 distinct byte values.";
    return;
  }
  status.classList.remove("error");
  status.textContent = `${bytes.length} UTF-8 bytes · ${leaves.length} distinct byte values`;
  inputBytes = bytes;
  trace = [{ forest: leaves }];
  const root = makeTree(freq, (parent, rest) => trace.push({ parent, forest: rest.sort(byWeight) }));
  codebook = canonical(codeLengths(root));
  scrub.max = trace.length - 1;
  goTo(0);
}

function draw(forest, active) {
  let cursor = 0;
  let deepest = 0;
  const positions = [];
  const branches = [];
  function visit(node, depth) {
    deepest = Math.max(deepest, depth);
    let x;
    if (node.symbol !== undefined) x = cursor++;
    else {
      const left = visit(node.left, depth + 1);
      const right = visit(node.right, depth + 1);
      x = (left.x + right.x) / 2;
      branches.push({ x, depth, child: left, bit: "0" }, { x, depth, child: right, bit: "1" });
    }
    const result = { x, depth, node };
    positions.push(result);
    return result;
  }
  for (const top of forest) {
    visit(top, 0);
    cursor += .29;
  }
  const extent = Math.max(0, cursor - 1.29);
  const width = Math.max(treeView.parentElement.clientWidth, Math.ceil(extent + 1) * 57);
  const space = Math.min(82, (width - 48) / Math.max(extent, 1));
  const xAt = (x) => width / 2 + (x - extent / 2) * space;
  const yAt = (depth) => 42 + depth * 54;
  treeView.style.width = `${width}px`;
  treeView.style.height = `${Math.max(165, yAt(deepest) + 39)}px`;
  const fragment = document.createDocumentFragment();
  for (const { x, depth, child, bit } of branches) {
    const x1 = xAt(x), y1 = yAt(depth);
    const dx = xAt(child.x) - x1, dy = yAt(child.depth) - y1;
    const line = element("span", undefined, "tree-line");
    line.style.cssText = `left:${x1}px;top:${y1}px;width:${Math.hypot(dx, dy)}px;transform:rotate(${Math.atan2(dy, dx)}rad)`;
    const edge = element("span", bit, "edge-bit");
    edge.style.cssText = `left:${x1 + dx / 2}px;top:${y1 + dy / 2}px`;
    fragment.append(line, edge);
  }
  for (const { x, depth, node } of positions) {
    const isParent = node.symbol === undefined;
    const chip = element("span", isParent ? String(node.weight) : label(node), "tree-node");
    chip.classList.toggle("parent", isParent);
    chip.classList.toggle("active", active.has(node.id));
    chip.style.cssText = `left:${xAt(x)}px;top:${yAt(depth)}px`;
    chip.append(element("small", isParent ? "MERGE" : String(node.weight)));
    fragment.append(chip);
  }
  treeView.replaceChildren(fragment);
}

function goTo(index) {
  const wasComplete = step === trace.length - 1 && !encodePanel.hidden;
  step = index;
  const { forest, parent } = trace[step];
  const complete = forest.length === 1;
  const next = complete ? [] : forest.slice(0, 2);
  const active = new Set(parent ? [parent.id, parent.left.id, parent.right.id] : next.map((node) => node.id));
  draw(forest, active);
  queue.replaceChildren(...forest.map((node, i) => {
    const item = element("li", undefined, i < next.length ? "next" : undefined);
    item.append(element("span", label(node)), element("strong", String(node.weight)));
    return item;
  }));
  get("queue-count").textContent = `${forest.length} ${forest.length === 1 ? "node" : "nodes"}`;
  get("step-count").textContent = `Merge ${step} / ${trace.length - 1}`;
  get("tree-summary").textContent = parent
    ? `Merged ${label(parent.left)} (${parent.left.weight}) and ${label(parent.right)} (${parent.right.weight}) to get ${parent.weight}.${complete ? " Tree complete." : ""}`
    : complete ? "A single distinct byte uses the one-bit code 0." : `Next merge: ${label(forest[0])} (${forest[0].weight}) + ${label(forest[1])} (${forest[1].weight}).`;
  get("lab-prev").disabled = step === 0;
  get("lab-next").disabled = complete;
  get("lab-play").disabled = trace.length < 2;
  scrub.value = step;
  scrub.disabled = trace.length < 2;
  encodePanel.hidden = !complete;
  if (!complete) stopDecoding();
  else if (!wasComplete) renderEncoding();
}

function highlightPair(index) {
  for (const [i, chip] of Array.from(sourceChips.children).entries()) chip.classList.toggle("highlight", i === index);
  for (const [i, chip] of Array.from(bitChips.children).entries()) chip.classList.toggle("highlight", i === index);
}

function renderEncoding() {
  stopDecoding();
  const { output, bitCount } = compress(inputBytes);
  decoded = decompress(output).output;
  sourceChips.replaceChildren();
  bitChips.replaceChildren();
  decodedChips.replaceChildren();
  get("decode-status").textContent = "";
  decodeButton.textContent = "Decode bitstream";
  decodeButton.disabled = false;
  for (const [index, byte] of inputBytes.entries()) {
    const name = byteLabel(byte);
    const source = element("button", name, "chip");
    source.type = "button";
    source.tabIndex = index ? -1 : 0;
    source.setAttribute("aria-label", `Byte ${index + 1}: ${name}, code ${codebook[byte].bits}`);
    source.addEventListener("mouseenter", () => highlightPair(index));
    source.addEventListener("mouseleave", () => {
      if (document.activeElement !== source) highlightPair(-1);
    });
    source.addEventListener("focus", () => highlightPair(index));
    source.addEventListener("blur", () => highlightPair(-1));
    source.addEventListener("click", () => highlightPair(index));
    source.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const next = (index + (event.key === "ArrowLeft" ? -1 : 1) + inputBytes.length) % inputBytes.length;
      source.tabIndex = -1;
      sourceChips.children[next].tabIndex = 0;
      sourceChips.children[next].focus();
    });
    const bits = element("span", codebook[byte].bits, "chip");
    sourceChips.append(source);
    bitChips.append(bits);
  }
  get("encode-summary").textContent = `${number.format(inputBytes.length * 8)} original bits → ${number.format(bitCount)} encoded bits · before archive overhead`;
  get("lab-codebook").replaceChildren(...Object.entries(codebook).map(([symbol, code]) =>
    element("span", `${byteLabel(Number(symbol))} → ${code.bits}`, "chip")));
}

function stopDecoding() {
  clearTimeout(decodeTimer);
  decodeTimer = undefined;
}

function decodeNext() {
  if (decodeIndex >= decoded.length) {
    stopDecoding();
    highlightPair(-1);
    const exact = decoded.length === inputBytes.length && decoded.every((byte, index) => byte === inputBytes[index]);
    get("decode-status").textContent = exact ? "✓ All bytes match the original" : "Byte comparison failed";
    decodeButton.textContent = "Replay decoding";
    return;
  }
  highlightPair(decodeIndex);
  decodedChips.append(element("span", byteLabel(decoded[decodeIndex]), "chip arrive"));
  decodeIndex++;
  decodeTimer = setTimeout(decodeNext, decoded.length > 40 ? 55 : 135);
}

decodeButton.addEventListener("click", () => {
  if (decodeTimer) {
    stopDecoding();
    decodeButton.textContent = "Resume decoding";
    return;
  }
  if (decodeIndex >= decoded.length || !decodedChips.childElementCount) {
    decodeIndex = 0;
    decodedChips.replaceChildren();
  }
  get("decode-status").textContent = "";
  if (reducedMotion.matches) {
    decodedChips.replaceChildren(...Array.from(decoded, (byte) => element("span", byteLabel(byte), "chip")));
    decodeIndex = decoded.length;
    decodeNext();
    return;
  }
  decodeButton.textContent = "Pause decoding";
  decodeNext();
});

function stopPlaying() {
  clearInterval(playTimer);
  playTimer = undefined;
  get("lab-play").textContent = "Play merges";
}

get("lab-form").addEventListener("submit", (event) => {
  event.preventDefault();
  stopPlaying();
  stopDecoding();
  encodePanel.hidden = true;
  decodeIndex = 0;
  buildTree();
  if (get("lab-error").classList.contains("error") && trace[step]?.forest.length === 1) {
    encodePanel.hidden = false;
    renderEncoding();
  }
});
get("lab-play").addEventListener("click", () => {
  if (playTimer) { stopPlaying(); return; }
  if (step >= trace.length - 1) goTo(0);
  get("lab-play").textContent = "Pause merges";
  playTimer = setInterval(() => {
    goTo(step + 1);
    if (step >= trace.length - 1) stopPlaying();
  }, 780);
});
get("lab-reset").addEventListener("click", () => { stopPlaying(); goTo(0); });
get("lab-next").addEventListener("click", () => { stopPlaying(); goTo(step + 1); });
get("lab-prev").addEventListener("click", () => { stopPlaying(); goTo(step - 1); });
scrub.addEventListener("input", () => { stopPlaying(); goTo(Number(scrub.value)); });

buildTree();
new ResizeObserver(() => {
  const current = trace[step];
  if (!current) return;
  const { forest, parent } = current;
  draw(forest, new Set(parent ? [parent.id, parent.left.id, parent.right.id] : forest.slice(0, 2).map((node) => node.id)));
}).observe(treeView.parentElement);
