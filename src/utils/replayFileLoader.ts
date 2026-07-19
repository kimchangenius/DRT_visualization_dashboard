import type { LoadedReplay } from './replayPayload';
import { parseReplayText } from './replayPayload';

export type { LoadedReplay } from './replayPayload';

type ReplayWorkerResponse =
  | { ok: true; replay: LoadedReplay }
  | { ok: false; message: string };

async function parseReplayOnMainThread(file: File): Promise<LoadedReplay> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error('Failed to read replay file.');
  }
  return parseReplayText(text, file.name);
}

export function loadReplayFile(file: File): Promise<LoadedReplay> {
  if (typeof Worker === 'undefined') {
    return parseReplayOnMainThread(file);
  }

  return new Promise((resolve, reject) => {
    let worker: Worker | null = null;
    let completed = false;

    const cleanup = () => {
      worker?.terminate();
      worker = null;
    };
    const resolveOnce = (replay: LoadedReplay) => {
      if (completed) return;
      completed = true;
      cleanup();
      resolve(replay);
    };
    const rejectOnce = (error: unknown) => {
      if (completed) return;
      completed = true;
      cleanup();
      reject(error);
    };
    const fallbackToMainThread = () => {
      if (completed) return;
      cleanup();
      void parseReplayOnMainThread(file).then(resolveOnce, rejectOnce);
    };

    try {
      worker = new Worker(
        new URL('../workers/replayParser.worker.ts', import.meta.url),
        { type: 'module' },
      );
    } catch {
      fallbackToMainThread();
      return;
    }

    worker.addEventListener('message', (event: MessageEvent<ReplayWorkerResponse>) => {
      if (event.data.ok) {
        resolveOnce(event.data.replay);
      } else {
        rejectOnce(new Error(event.data.message));
      }
    });
    worker.addEventListener('error', event => {
      event.preventDefault();
      fallbackToMainThread();
    }, { once: true });
    worker.addEventListener('messageerror', fallbackToMainThread, { once: true });
    worker.postMessage(file);
  });
}
