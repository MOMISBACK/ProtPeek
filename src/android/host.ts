// SPDX-License-Identifier: MPL-2.0
import { StructureLoadError } from '../structures/loaders/errors';

export const MAX_ANDROID_FILE_BYTES = 32 * 1024 * 1024;

export interface AndroidExport {
  filename: string;
  mimeType: string;
  text?: string;
  base64?: string;
}

interface AndroidNativeBridge {
  openFile(): void;
  exportFile(payloadJSON: string): void;
  shareFile(payloadJSON: string): void;
  ready(): void;
  getTheme?(): string;
}

declare global {
  interface Window {
    ProtPeekAndroid?: AndroidNativeBridge;
    ProtPeekAndroidUI?: { back(): boolean };
  }
}

export interface AndroidOpenedFile {
  name: string;
  mimeType: string;
  base64: string;
}

export function nativeHost(): AndroidNativeBridge | undefined {
  return window.ProtPeekAndroid;
}

export function decodeOpenedFile(value: unknown): File {
  if (typeof value !== 'object' || value === null) throw new Error('The selected file could not be read.');
  const item = value as Partial<AndroidOpenedFile>;
  if (typeof item.name !== 'string' || typeof item.base64 !== 'string') throw new Error('The selected file could not be read.');
  if (item.base64.length > Math.ceil(MAX_ANDROID_FILE_BYTES / 3) * 4) {
    throw new StructureLoadError('file-too-large', 'Choose a structure smaller than 32 MB.');
  }
  const raw = atob(item.base64);
  if (raw.length > MAX_ANDROID_FILE_BYTES) throw new StructureLoadError('file-too-large', 'Choose a structure smaller than 32 MB.');
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new File([bytes], item.name, { type: typeof item.mimeType === 'string' ? item.mimeType : 'application/octet-stream' });
}

/** Bound both declared and streaming downloads before the existing parsers run. */
export const androidFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const declared = Number(response.headers.get('content-length'));
  if (response.ok && Number.isFinite(declared) && declared > MAX_ANDROID_FILE_BYTES) {
    await response.body?.cancel();
    throw new StructureLoadError('file-too-large', 'Choose a structure smaller than 32 MB.');
  }
  if (!response.ok || response.body === null) return response;
  const reader = response.body.getReader();
  let bytes = 0;
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) { controller.close(); return; }
        bytes += result.value.byteLength;
        if (bytes > MAX_ANDROID_FILE_BYTES) {
          await reader.cancel();
          controller.error(new StructureLoadError('file-too-large', 'Choose a structure smaller than 32 MB.'));
          return;
        }
        controller.enqueue(result.value);
      } catch (error) { controller.error(error); }
    },
    cancel: () => reader.cancel(),
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
};

export function sendExport(payload: AndroidExport, share: boolean): void {
  if (payload.text === undefined && payload.base64 === undefined) throw new Error('No file is available to export.');
  const host = nativeHost();
  if (host !== undefined) {
    if (share) host.shareFile(JSON.stringify(payload));
    else host.exportFile(JSON.stringify(payload));
    return;
  }
  // Browser preview fallback. Android uses its system document picker/share sheet.
  if (share) throw new Error('Sharing is available in the Android app. Use Save in this browser preview.');
  let href: string;
  if (payload.text !== undefined) {
    if (new Blob([payload.text]).size > MAX_ANDROID_FILE_BYTES) throw new Error('This export exceeds the 32 MB mobile limit.');
    href = URL.createObjectURL(new Blob([payload.text], { type: payload.mimeType }));
  } else href = `data:${payload.mimeType};base64,${payload.base64 ?? ''}`;
  const anchor = document.createElement('a');
  anchor.href = href; anchor.download = payload.filename; document.body.append(anchor);
  anchor.click(); anchor.remove();
  if (href.startsWith('blob:')) window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
}
