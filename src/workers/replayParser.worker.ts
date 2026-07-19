/// <reference lib="webworker" />

import { parseReplayText } from '../utils/replayPayload';
import type { LoadedReplay } from '../utils/replayPayload';

type ReplayWorkerResponse =
  | { ok: true; replay: LoadedReplay }
  | { ok: false; message: string };

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener('message', (event: MessageEvent<File>) => {
  void (async () => {
    try {
      let text: string;
      try {
        text = await event.data.text();
      } catch {
        throw new Error('Failed to read replay file.');
      }
      const response: ReplayWorkerResponse = {
        ok: true,
        replay: parseReplayText(text, event.data.name),
      };
      workerScope.postMessage(response);
    } catch (error) {
      const response: ReplayWorkerResponse = {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to load replay file.',
      };
      workerScope.postMessage(response);
    }
  })();
});
