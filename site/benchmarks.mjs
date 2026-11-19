import { samples } from "./samples.mjs";
import { bytes, element, get, startWorker } from "./ui.mjs";

const button = get("run-bench");
const status = get("bench-status");

async function gzipSize(data) {
  if (typeof CompressionStream !== "function") return null;
  try {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
    return (await new Response(stream).arrayBuffer()).byteLength;
  } catch {
    return null;
  }
}

function renderBench(results) {
  const bars = get("bench-bars");
  const table = get("bench-table");
  const scale = Math.max(1, ...results.flatMap((run) => [run.archiveSize / run.inputSize, (run.gzip ?? 0) / run.inputSize]));
  bars.replaceChildren();
  table.replaceChildren();
  for (const [i, run] of results.entries()) {
    const row = element("div", undefined, "bench-row");
    const track = element("div", undefined, "bench-track");
    track.style.setProperty("--baseline", `${100 / scale}%`);
    track.setAttribute("aria-hidden", "true");
    for (const [kind, value] of [["huf", run.archiveSize], ["gzip", run.gzip]]) {
      if (value === null) continue;
      const bar = element("b", undefined, kind);
      bar.style.setProperty("--bar-size", `${100 * (value / run.inputSize) / scale}%`);
      bar.style.setProperty("--order", i);
      track.append(bar);
    }
    row.append(element("strong", run.sample.label), track);
    bars.append(row);

    const tr = element("tr");
    const label = element("td");
    const link = element("a", run.sample.label);
    link.href = `/workspace/?sample=${run.sample.id}`;
    link.title = run.sample.description;
    label.append(link);
    const saving = (1 - run.archiveSize / run.inputSize) * 100;
    const savingCell = element("td", saving < 0 ? `${Math.abs(saving).toFixed(1)}% larger` : `${saving.toFixed(1)}%`, saving < 0 ? "bad" : "good");
    tr.append(
      label, element("td", bytes(run.inputSize)), element("td", bytes(run.archiveSize)), savingCell,
      element("td", run.gzip === null ? "Unavailable" : bytes(run.gzip)),
      element("td", run.exact ? "Byte match" : "Failed", run.exact ? "good" : "bad")
    );
    table.append(tr);
  }
  get("bench-empty").hidden = true;
  get("bench-results").hidden = false;
}

async function runBenchmark() {
  button.disabled = true;
  button.textContent = "Measuring…";
  status.classList.remove("bad");
  const results = [];
  try {
    for (const [i, sample] of samples.entries()) {
      status.textContent = `Running sample ${i + 1} of ${samples.length}…`;
      const data = await sample.bytes();
      const [run, gzip] = await Promise.all([
        startWorker("benchmark", data.slice().buffer),
        gzipSize(data),
      ]);
      results.push({ ...run, sample, gzip });
    }
    renderBench(results);
    status.textContent = `${results.length} samples measured`;
    button.textContent = "Run again";
  } catch (error) {
    status.classList.add("bad");
    status.textContent = error.message || "Benchmark could not complete.";
    button.textContent = "Retry benchmark";
  } finally {
    button.disabled = false;
  }
}

button.addEventListener("click", runBenchmark);
runBenchmark();
