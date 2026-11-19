import { byteLabel, element, number, reducedMotion } from "./ui.mjs";

export function mountEncoding(target, values, codeByByte, onChange = () => {}) {
  let offset = 0;
  const entries = Array.from(values, (value) => {
    const bits = codeByByte.get(value);
    const entry = { value, bits, label: byteLabel(value), asByte: value.toString(2).padStart(8, "0"), offset };
    offset += bits.length;
    return entry;
  });
  const root = element("div", undefined, "encoding");
  const lanes = element("div", undefined, "encoding-lanes");
  const scroller = element("div", undefined, "encoding-scroll");
  scroller.tabIndex = 0;
  scroller.setAttribute("aria-label", "Input bytes and the corresponding output codes");
  const canvas = element("div", undefined, "encoding-canvas");
  const ins = element("div", undefined, "encoding-line source-line");
  const outs = element("div", undefined, "encoding-line bit-line");
  const flow = element("div", undefined, "encoding-flow");
  flow.setAttribute("aria-hidden", "true");
  flow.append(element("span", "↓"));
  const header = (label, size) => {
    const node = element("div", undefined, "lane-heading");
    node.append(element("span", label), element("small", size));
    return node;
  };
  const inputHeading = header("Input bytes", `${number.format(entries.length * 8)} bits`);
  const outputHeading = header("Encoded bitstream", "");
  canvas.append(inputHeading, ins, flow, outputHeading, outs);
  scroller.append(canvas);
  lanes.append(scroller);
  const detail = element("div", undefined, "encoding-detail");
  const detailLabel = element("span", "Next byte", "encoding-detail-label");
  const identity = element("strong", undefined, "encoding-identity");
  const mapping = element("div", undefined, "encoding-mapping");
  const oldCode = element("code");
  const newCode = element("code");
  const range = element("p", undefined, "encoding-range");
  mapping.append(oldCode, element("span", "→"), newCode);
  detail.append(detailLabel, identity, mapping, range);
  root.append(lanes, detail);
  target.replaceChildren(root);

  const inputNodes = [];
  const outputNodes = [];
  for (const { label, asByte, bits } of entries) {
    const input = element("span", label, "byte-cell");
    input.title = `Byte ${label}: ${asByte}`;
    const output = element("span", undefined, "bit-code");
    output.setAttribute("aria-label", `Code for ${label}: ${bits}`);
    for (const bit of bits) output.append(element("span", bit));
    ins.append(input);
    outs.append(output);
    inputNodes.push(input);
    outputNodes.push(output);
  }

  let cursor = 0;
  let timer;
  let flight;

  function follow(input, output) {
    const frame = scroller.getBoundingClientRect();
    const left = Math.min(input.getBoundingClientRect().left, output.getBoundingClientRect().left);
    const right = Math.max(input.getBoundingClientRect().right, output.getBoundingClientRect().right);
    if (right > frame.right - 8) scroller.scrollLeft += right - frame.right + 14;
    else if (left < frame.left + 8) scroller.scrollLeft -= frame.left + 12 - left;
  }

  function render() {
    const index = Math.max(0, cursor - 1);
    const active = entries[index];
    const written = cursor ? active.offset + active.bits.length : 0;
    for (const [i, node] of inputNodes.entries()) {
      node.classList.toggle("used", i < cursor);
      node.classList.toggle("current", i === index);
      outputNodes[i].classList.toggle("written", i < cursor);
      outputNodes[i].setAttribute("aria-hidden", String(i >= cursor));
      outputNodes[i].classList.toggle("current", i === index && cursor > 0);
    }
    outputHeading.lastElementChild.textContent = `${written} / ${offset} bits`;
    if (active) {
      detailLabel.textContent = cursor ? `Byte ${cursor} of ${entries.length}` : "First byte";
      identity.textContent = active.label;
      identity.classList.toggle("long", active.label.length > 2);
      oldCode.textContent = active.asByte;
      newCode.textContent = active.bits;
      const first = active.offset + 1;
      const last = active.offset + active.bits.length;
      range.textContent = first === last ? `Writes bit ${first}` : `Writes bits ${first}–${last}`;
    }
    onChange({ cursor, total: entries.length, written, bitCount: offset, playing: Boolean(timer) });
  }

  function removeFlight() {
    flight?.remove();
    flight = undefined;
  }

  function animate(index) {
    removeFlight();
    const from = inputNodes[index];
    const to = outputNodes[index];
    follow(from, to);
    if (reducedMotion.matches || typeof from.animate !== "function") return;
    const frame = lanes.getBoundingClientRect();
    const origin = from.getBoundingClientRect();
    const end = to.getBoundingClientRect();
    const packet = element("span", entries[index].bits, "encoding-packet");
    packet.setAttribute("aria-hidden", "true");
    packet.style.left = `${origin.left + origin.width / 2 - frame.left}px`;
    packet.style.top = `${origin.top + origin.height / 2 - frame.top}px`;
    lanes.append(packet);
    flight = packet;
    const dx = (end.left + end.width / 2) - (origin.left + origin.width / 2);
    const dy = (end.top + end.height / 2) - (origin.top + origin.height / 2);
    const animation = packet.animate([
      { transform: "translate(-50%, -50%) scale(.8)", opacity: 0 },
      { offset: .19, transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
      { offset: .78, transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.9)`, opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.75)`, opacity: 0 },
    ], { duration: 410, easing: "cubic-bezier(.3,.12,.28,1)" });
    animation.onfinish = () => packet.remove();
  }

  function pause() {
    clearInterval(timer);
    timer = undefined;
    render();
  }

  function next() {
    if (cursor === entries.length) return;
    animate(cursor);
    cursor++;
    if (cursor === entries.length) pause();
    else render();
  }

  function reset() {
    removeFlight();
    cursor = 0;
    scroller.scrollLeft = 0;
    pause();
  }

  function play() {
    if (timer || !entries.length) return;
    if (cursor === entries.length) reset();
    timer = setInterval(next, 550);
    next();
  }

  function dispose() {
    clearInterval(timer);
    removeFlight();
  }

  render();
  return { next, pause, play, reset, dispose, get playing() { return Boolean(timer); } };
}
