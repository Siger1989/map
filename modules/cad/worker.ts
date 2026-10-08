import { decodeCadInline } from './decoder.ts';

type Request = { buffer: ArrayBuffer; name: string };

self.addEventListener('message', (event: MessageEvent<Request>) => {
  void decodeCadInline(event.data.buffer, event.data.name)
    .then((result) => self.postMessage({ result }))
    .catch((error: unknown) => self.postMessage({ error: error instanceof Error ? error.message : String(error) }));
});
