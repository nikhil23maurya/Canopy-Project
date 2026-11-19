export const MAX_BYTES = 24 * 1024 * 1024;
const HEADER = 18;
const MAGIC = 0x48554631;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

export function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

class MinHeap {
  nodes = [];

  static before(a, b) {
    return a.weight === b.weight ? a.minimum < b.minimum : a.weight < b.weight;
  }

  push(node) {
    const { nodes } = this;
    let i = nodes.length;
    nodes.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!MinHeap.before(node, nodes[parent])) break;
      nodes[i] = nodes[parent];
      i = parent;
    }
    nodes[i] = node;
  }

  pop() {
    const { nodes } = this;
    const first = nodes[0];
    const last = nodes.pop();
    if (!nodes.length) return first;
    let i = 0;
    while (2 * i + 1 < nodes.length) {
      let child = 2 * i + 1;
      if (child + 1 < nodes.length && MinHeap.before(nodes[child + 1], nodes[child])) child++;
      if (!MinHeap.before(nodes[child], last)) break;
      nodes[i] = nodes[child];
      i = child;
    }
    nodes[i] = last;
    return first;
  }
}

export function makeTree(frequencies, onMerge) {
  const heap = new MinHeap();
  frequencies.forEach((weight, symbol) => {
    if (weight) heap.push({ symbol, weight, minimum: symbol, id: symbol });
  });
  let id = frequencies.length;
  while (heap.nodes.length > 1) {
    const left = heap.pop();
    const right = heap.pop();
    const parent = { left, right, weight: left.weight + right.weight, minimum: Math.min(left.minimum, right.minimum), id: id++ };
    heap.push(parent);
    onMerge?.(parent, [...heap.nodes]);
  }
  return heap.nodes[0];
}

export function codeLengths(root) {
  const lengths = new Uint8Array(256);
  if (!root) return lengths;
  const visit = (node, depth) => {
    if (node.symbol !== undefined) {
      lengths[node.symbol] = Math.max(1, depth);
      return;
    }
    visit(node.left, depth + 1);
    visit(node.right, depth + 1);
  };
  visit(root, 0);
  return lengths;
}

export function canonical(lengths) {
  const ordered = Array.from(lengths, (length, symbol) => ({ length, symbol }))
    .filter(({ length }) => length)
    .sort((a, b) => a.length - b.length || a.symbol - b.symbol);
  let value = 0n;
  let previous = 0;
  const book = [];
  for (const { length, symbol } of ordered) {
    value <<= BigInt(length - previous);
    if (value >= (1n << BigInt(length))) throw Error("Invalid Huffman code lengths.");
    book[symbol] = {
      length,
      bits: value.toString(2).padStart(length, "0"),
      value: length <= 24 ? Number(value) : null,
    };
    value++;
    previous = length;
  }
  return book;
}

export function compress(data, progress = () => {}) {
  if (data.length > MAX_BYTES) throw Error("Choose a file up to 24 MiB.");
  const frequencies = new Uint32Array(256);
  for (const byte of data) frequencies[byte]++;
  progress(0.29, "Building the Huffman tree");
  const lengths = codeLengths(makeTree(frequencies));
  const book = canonical(lengths);
  const rows = [];
  let bitCount = 0;
  for (let symbol = 0; symbol < 256; symbol++) {
    const code = book[symbol];
    if (!code) continue;
    const frequency = frequencies[symbol];
    bitCount += frequency * code.length;
    rows.push({ symbol, frequency, length: code.length, bits: code.bits });
  }
  const start = HEADER + rows.length * 2;
  const output = new Uint8Array(start + Math.ceil(bitCount / 8));
  const view = new DataView(output.buffer);
  view.setUint32(0, MAGIC);
  view.setBigUint64(4, BigInt(data.length));
  view.setUint16(12, rows.length);
  view.setUint32(14, crc32(data));
  for (const [index, row] of rows.entries()) {
    output[HEADER + index * 2] = row.symbol;
    output[HEADER + index * 2 + 1] = row.length;
  }
  let pending = 0;
  let count = 0;
  let cursor = start;
  progress(0.42, "Packing the bitstream");
  for (let i = 0; i < data.length; i++) {
    const code = book[data[i]];
    if (code.value === null) {
      for (const bit of code.bits) {
        pending = (pending << 1) | (bit === "1" ? 1 : 0);
        if (++count === 8) {
          output[cursor++] = pending;
          pending = 0;
          count = 0;
        }
      }
    } else {
      pending = (pending << code.length) | code.value;
      count += code.length;
      while (count >= 8) {
        count -= 8;
        output[cursor++] = pending >>> count;
        pending &= (1 << count) - 1;
      }
    }
    if ((i & 0x7ffff) === 0) progress(0.42 + 0.52 * (i / data.length), "Packing the bitstream");
  }
  if (count) output[cursor] = pending << (8 - count);
  rows.sort((a, b) => b.frequency - a.frequency || a.symbol - b.symbol);
  return { output, rows, headerBytes: start, bitCount };
}

export function decompress(data, progress = () => {}) {
  if (data.length < HEADER) throw Error("This file is too short to be a HUF1 archive.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0) !== MAGIC) throw Error("Choose a HUF1 .huf archive from Huffman Studio.");
  const size = view.getBigUint64(4);
  if (size > BigInt(MAX_BYTES)) throw Error("This archive restores more than the 24 MiB browser limit.");
  const count = view.getUint16(12);
  const expected = view.getUint32(14);
  const start = HEADER + count * 2;
  if (count > 256 || start > data.length || (size === 0n) !== (count === 0) || BigInt(count) > size) {
    throw Error("The archive has an invalid code table.");
  }
  const outputSize = Number(size);
  if (outputSize > (data.length - start) * 8) throw Error("The archive payload is truncated.");
  const lengths = new Uint8Array(256);
  for (let offset = HEADER; offset < start; offset += 2) {
    const symbol = data[offset];
    const length = data[offset + 1];
    if (!length || lengths[symbol]) throw Error("The archive contains an invalid code entry.");
    lengths[symbol] = length;
  }
  const book = canonical(lengths);
  const root = [];
  for (const [symbol, code] of book.entries()) {
    if (!code) continue;
    let node = root;
    for (const bit of code.bits) {
      const idx = Number(bit);
      node[idx] ??= [];
      node = node[idx];
    }
    node.symbol = symbol;
  }
  const output = new Uint8Array(outputSize);
  let node = root;
  let written = 0;
  let cursor = start * 8;
  progress(0.31, "Decoding the bitstream");
  while (written < outputSize && cursor < data.length * 8) {
    const bit = (data[cursor >> 3] >> (7 - (cursor & 7))) & 1;
    cursor++;
    node = node[bit];
    if (!node) throw Error("The archive contains an invalid bit sequence.");
    if (node.symbol !== undefined) {
      output[written++] = node.symbol;
      node = root;
      if ((written & 0x7ffff) === 0) progress(0.31 + 0.56 * (written / outputSize), "Decoding the bitstream");
    }
  }
  if (written !== outputSize) throw Error("The archive payload is truncated.");
  if (Math.ceil(cursor / 8) !== data.length) throw Error("The archive has unexpected trailing bytes.");
  if ((cursor & 7) && (data.at(-1) & ((1 << (8 - (cursor & 7))) - 1))) {
    throw Error("The archive contains invalid padding.");
  }
  progress(0.92, "Verifying CRC32");
  if (crc32(output) !== expected) throw Error("CRC32 verification failed. The archive may be corrupted.");
  return { output, headerBytes: start, bitCount: cursor - start * 8 };
}
