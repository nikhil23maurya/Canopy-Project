export const get = (id) => document.getElementById(id);
export const number = new Intl.NumberFormat("en-IN");
export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

export function bytes(size) {
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(2)} MiB`;
  if (size >= 1024) return `${(size / 1024).toFixed(2)} KiB`;
  return `${number.format(size)} B`;
}

export function byteLabel(value) {
  if (value === 32) return "SPACE";
  if (value === 10) return "LF";
  if (value === 13) return "CR";
  if (value === 9) return "TAB";
  if (value >= 33 && value <= 126) return String.fromCharCode(value);
  return `0x${value.toString(16).padStart(2, "0").toUpperCase()}`;
}

export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function startWorker(mode, buffer, onProgress, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => {
      cleanup();
      reject(Error("The browser could not start the compression engine."));
    };
    worker.onmessageerror = () => {
      cleanup();
      reject(Error("The browser could not read the compression result."));
    };
    worker.onmessage = ({ data: message }) => {
      if (message.type === "progress") {
        onProgress?.(message.value, message.label);
        return;
      }
      cleanup();
      if (message.type === "error") reject(Error(message.message));
      else resolve(message);
    };
    try {
      worker.postMessage({ mode, buffer }, [buffer]);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
