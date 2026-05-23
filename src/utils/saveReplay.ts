import type { SimulationReplayPayload } from '../types/simulation';

type SavePickerOptions = {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
};

type FileSystemWritable = {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
};

type FileSystemFileHandle = {
  createWritable: () => Promise<FileSystemWritable>;
};

type WindowWithSavePicker = Window & {
  showSaveFilePicker?: (options?: SavePickerOptions) => Promise<FileSystemFileHandle>;
};

function replayBlob(payload: SimulationReplayPayload): Blob {
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

function fallbackDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function saveReplayJson(payload: SimulationReplayPayload, filename: string) {
  const blob = replayBlob(payload);
  const savePicker = (window as WindowWithSavePicker).showSaveFilePicker;

  if (savePicker) {
    const handle = await savePicker({
      suggestedName: filename,
      types: [
        {
          description: 'Replay JSON',
          accept: { 'application/json': ['.json'] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  fallbackDownload(blob, filename);
}
