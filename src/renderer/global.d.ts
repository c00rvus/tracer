import type { TracerApi } from "../shared/ipc";

declare global {
  interface Window {
    tracer: TracerApi;
  }
}

export {};
