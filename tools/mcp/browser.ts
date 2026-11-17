/**
 * Rendu d'un village dans un Chrome sans fenêtre, piloté par le protocole
 * DevTools (WebSocket natif de Node, aucune dépendance) : l'app s'ouvre sur
 * le lien de partage du village, puis l'API `window.villagecraft` règle
 * l'ambiance et la caméra et renvoie la capture du canvas.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface RenderOptions {
  /** URL de partage complète (`…/#v=<code>`) : l'app charge le village au démarrage. */
  shareLink: string;
  width?: number;
  height?: number;
  ambience?: string;
  camera?: { position?: [number, number, number]; target?: [number, number, number] };
  /** Chrome à lancer (sinon CHROME_PATH, sinon les emplacements habituels). */
  chromePath?: string;
  timeoutMs?: number;
}

function findChrome(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((path) => path && existsSync(path));
  if (!found) throw new Error('Chrome not found: set CHROME_PATH to a Chrome or Chromium executable');
  return found;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rend le village et renvoie l'image PNG. */
export async function renderVillage(options: RenderOptions): Promise<Buffer> {
  const { shareLink, width = 1200, height = 630, ambience, camera, timeoutMs = 180_000 } = options;
  const profile = mkdtempSync(join(tmpdir(), 'villagecraft-mcp-'));
  const chrome = spawn(
    findChrome(options.chromePath),
    [
      '--headless=new',
      // Port choisi par Chrome, écrit dans DevToolsActivePort.
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const deadline = Date.now() + timeoutMs;
  let socket: WebSocket | null = null;
  try {
    let port = 0;
    while (!port) {
      if (Date.now() > deadline) throw new Error('Chrome did not start');
      await sleep(100);
      const file = join(profile, 'DevToolsActivePort');
      if (existsSync(file)) port = Number(readFileSync(file, 'utf8').split('\n')[0]);
    }
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
      type: string;
      webSocketDebuggerUrl: string;
    }>;
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('no Chrome page to drive');

    const ws = (socket = new WebSocket(page.webSocketDebuggerUrl));
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    let nextId = 1;
    const pending = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>();
    ws.addEventListener('message', (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as { id?: number; result?: unknown; error?: { message: string } };
      if (message.id !== undefined) pending.get(message.id)?.(message);
    });
    const send = <T>(method: string, params: Record<string, unknown> = {}) =>
      new Promise<T>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, (message) => {
          pending.delete(id);
          if (message.error) reject(new Error(`${method}: ${message.error.message}`));
          else resolve(message.result as T);
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async <T>(expression: string): Promise<T> => {
      const result = await send<{ result: { value: T }; exceptionDetails?: { exception?: { description?: string } } }>(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
      );
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'page error');
      return result.result.value;
    };

    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: shareLink });
    while (!(await evaluate<boolean>('!!window.villagecraft?.screenshot').catch(() => false))) {
      if (Date.now() > deadline)
        throw new Error('the app did not start (window.villagecraft missing: is the URL right?)');
      await sleep(250);
    }
    if (ambience) await evaluate(`window.villagecraft.setAmbience(${JSON.stringify(ambience)})`);
    if (camera) await evaluate(`window.villagecraft.setCamera(${JSON.stringify(camera)})`);
    const dataUrl = await evaluate<string>('window.villagecraft.screenshot()');
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  } finally {
    socket?.close();
    chrome.kill();
    // Chrome garde son profil verrouillé un instant après sa fin.
    await sleep(300);
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
