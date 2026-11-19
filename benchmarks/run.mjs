import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { cpus } from "node:os";
import { compress, decompress, MAX_BYTES } from "../site/codec.mjs";
import { samples } from "../site/samples.mjs";

// Benchmark the same codec used in the browser and check that restoration is exact.
const start = performance.now.bind(performance);
const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const scriptRoot = new URL("../site/", import.meta.url);
const log = samples[0].bytes();
function sizedInput(size) {
  const result = Buffer.allocUnsafe(size);
  for (let offset = 0; offset < size; offset += log.length) {
    result.set(log.subarray(0, size - offset), offset);
  }
  return result;
}
const comp = [], dec = [], combined = [];
const sizes = [256, 512, 1024, 2048, 4096];
const inputs = sizes.map(size => sizedInput(size * 1024));
for (let run = 0; run < 3; run++) {
  assert(Buffer.from(decompress(compress(inputs[run]).output).output).equals(inputs[run]));
}
for (const input of inputs) {
  const ct = [], dt = [], tt = [];
  for (let repeat = 0; repeat < 7; repeat++) {
    const t0 = start();
    const archive = compress(input).output;
    const t1 = start();
    const restored = decompress(archive).output;
    const t2 = start();
    assert(Buffer.from(restored).equals(input));
    ct.push(t1 - t0);
    dt.push(t2 - t1);
    tt.push(t2 - t0);
  }
  comp.push(+median(ct).toFixed(2));
  dec.push(+median(dt).toFixed(2));
  combined.push(+median(tt).toFixed(2));
}
const fixtures = [];
for (const fixture of samples) {
  const input = fixture.id === "packed" ? readFileSync(new URL("assets/device-logs.txt.gz", scriptRoot)) : Buffer.from(await fixture.bytes());
  const archive = compress(input).output;
  assert(Buffer.from(decompress(archive).output).equals(input));
  fixtures.push({id: fixture.id, label: fixture.label, original: input.length, huf: archive.length, gzip: gzipSync(input).length});
}
const edge = {};
const check = (id, input) => {
  const packed = compress(input);
  assert(Buffer.from(decompress(packed.output).output).equals(input));
  edge[id] = { archiveBytes: packed.output.length, payloadBits: packed.bitCount };
};
check("empty", Buffer.alloc(0));
check("single", Buffer.alloc(1024, 65));
check("allSymbols", Buffer.from(Array.from({length: 256}, (_, i) => i)));
check("limit", Buffer.alloc(MAX_BYTES, 65));
assert.throws(() => compress(Buffer.alloc(MAX_BYTES + 1)), /24 MiB/);
const valid = compress(log).output;
assert.throws(() => decompress(valid.slice(0,-1)), /truncated/);
const changed = valid.slice();
changed[14] ^= 1;
assert.throws(() => decompress(changed), /CRC32 verification failed/);

// For three symbols, an optimal full binary prefix tree has depths 1, 2, and 2.
let optChecks = 0;
for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) for (let c = 1; c <= 5; c++) {
  const input = Buffer.from("A".repeat(a) + "B".repeat(b) + "C".repeat(c));
  let min = Infinity;
  for(let i=1; i<=2; i++) for(let j=1; j<=2; j++) for(let k=1; k<=2; k++) {
    if (2**-i+2**-j+2**-k<=1) min=Math.min(min,a*i+b*j+c*k);
  }
  assert.equal(compress(input).bitCount,min);
  optChecks++;
}
const result = {sizes,comp,dec,combined,fixtures,edge,optChecks,node:process.version,arch:process.arch,cpu:cpus()[0]?.model};
console.log(JSON.stringify(result,null,2));
