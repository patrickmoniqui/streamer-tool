// Start Vite only after the local API is accepting requests. This avoids leaving
// the initial connection check in an error state while Wrangler is still loading.
const endpoint = 'http://127.0.0.1:8787/api/twitch/connection';
const deadline = Date.now() + 60000;
console.log('Waiting for the local Worker on port 8787…');
while (true) {
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(1000) });
    if (response.ok && response.headers.get('Content-Type')?.includes('application/json')) {
      const status = await response.json();
      if (typeof status.ready === 'boolean') break;
    }
  } catch { /* Wrangler may still be initializing local storage. */ }
  if (Date.now() >= deadline) {
    console.error('The local Worker did not start on port 8787. Check the worker logs above.');
    process.exit(1);
  }
  await new Promise(resolve => setTimeout(resolve, 250));
}
console.log('Local Worker ready. Starting Vite.');
