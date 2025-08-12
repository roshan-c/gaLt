import { metrics } from '../utils/Metrics';

export function startMetricsServer(port: number = Number(process.env.METRICS_PORT || 8787)) {
  const g: any = globalThis as any;
  if (g.__GA_LT_METRICS_SERVER_STARTED) return;

  const BunRef: any = (globalThis as any).Bun;
  if (BunRef && typeof BunRef.serve === 'function') {
    const server = BunRef.serve({
      port,
      fetch: async (req: Request) => {
        const url = new URL(req.url);
        if (url.pathname === '/api/metrics') {
          const body = JSON.stringify(metrics.getAllDays());
          return new Response(body, {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
          });
        }

        // Simple dashboard UI
        const html = getDashboardHtml();
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      },
    });
    g.__GA_LT_METRICS_SERVER_STARTED = true;
    console.log(`📈 Metrics dashboard running at http://localhost:${server.port}`);
    return;
  }

  // Fallback: minimal Fetch-based server using undici/whatwg (rarely used under Bun)
  addEventListener('fetch', (event: any) => {
    const url = new URL(event.request.url);
    if (url.pathname === '/api/metrics') {
      event.respondWith(
        new Response(JSON.stringify(metrics.getAllDays()), {
          headers: { 'Content-Type': 'application/json' },
        })
      );
      return;
    }
    event.respondWith(new Response(getDashboardHtml(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  });
  g.__GA_LT_METRICS_SERVER_STARTED = true;
  console.log(`📈 Metrics dashboard event-listener server registered on port ${port}`);
}

function getDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>gaLt Metrics</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 24px; background: #0b0d12; color: #e5e7eb; }
    h1 { margin: 0 0 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 10px; padding: 16px; }
    .muted { color: #9ca3af; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px; border-bottom: 1px solid #1f2937; text-align: left; }
    .right { text-align: right; }
    a { color: #93c5fd; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  </head>
  <body>
    <h1>gaLt Metrics</h1>
    <p class="muted">Live usage stats. Auto-refreshes every 10s.</p>
    <div class="grid">
      <div class="card"><div class="muted">Requests (today)</div><div id="reqToday" style="font-size:28px;font-weight:700">–</div></div>
      <div class="card"><div class="muted">Tokens (today)</div><div id="tokToday" style="font-size:28px;font-weight:700">–</div></div>
      <div class="card"><div class="muted">Images (today)</div><div id="imgToday" style="font-size:28px;font-weight:700">–</div></div>
      <div class="card"><div class="muted">Est. Cost (today)</div><div id="costToday" style="font-size:28px;font-weight:700">–</div></div>
    </div>
    <div class="card" style="margin-bottom:24px">
      <canvas id="tokensChart" height="120"></canvas>
    </div>
    <div class="card">
      <h3>Daily Breakdown</h3>
      <table>
        <thead><tr><th>Date</th><th class="right">Requests</th><th class="right">Tokens (in/out/total)</th><th class="right">Images</th><th class="right">Est. Cost</th></tr></thead>
        <tbody id="days"></tbody>
      </table>
    </div>
    <script>
      async function fetchData(){
        const res = await fetch('/api/metrics', { cache: 'no-store' });
        const data = await res.json();
        render(data);
      }
      function render(days){
        const todayKey = new Date().toISOString().split('T')[0];
        const today = days.find(d => d.date === todayKey) || { requests:0, tokens:{input:0,output:0,total:0,costUsd:0}, image:{count:0,estimatedCostUsd:0} };
        document.getElementById('reqToday').textContent = today.requests.toLocaleString();
        document.getElementById('tokToday').textContent = today.tokens.total.toLocaleString();
        document.getElementById('imgToday').textContent = today.image.count.toLocaleString();
        document.getElementById('costToday').textContent = '$' + (today.image.estimatedCostUsd + (today.tokens.costUsd||0)).toFixed(2);

        // Table
        const tbody = document.getElementById('days');
        tbody.innerHTML = '';
        for(const d of days){
          const tr = document.createElement('tr');
          tr.innerHTML =
            '<td>' + d.date + '</td>' +
            '<td class="right">' + d.requests.toLocaleString() + '</td>' +
            '<td class="right">' + d.tokens.input.toLocaleString() + ' / ' + d.tokens.output.toLocaleString() + ' / ' + d.tokens.total.toLocaleString() + '</td>' +
            '<td class="right">' + d.image.count + '</td>' +
            '<td class="right">$' + (((d.image.estimatedCostUsd||0) + (d.tokens.costUsd||0)).toFixed(2)) + '</td>';
          tbody.appendChild(tr);
        }

        // Chart
        const labels = days.map(d => d.date);
        const input = days.map(d => d.tokens.input);
        const output = days.map(d => d.tokens.output);
        const total = days.map(d => d.tokens.total);
        if(window.__chart){ window.__chart.destroy(); }
        const ctx = document.getElementById('tokensChart');
        window.__chart = new Chart(ctx, {
          type: 'line',
          data: {
            labels,
            datasets: [
              { label: 'Input Tokens', data: input, borderColor: '#93c5fd' },
              { label: 'Output Tokens', data: output, borderColor: '#fca5a5' },
              { label: 'Total Tokens', data: total, borderColor: '#86efac' }
            ]
          },
          options: {
            plugins: { legend: { labels: { color: '#e5e7eb' } } },
            scales: {
              x: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } },
              y: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } }
            }
          }
        });
      }
      fetchData();
      setInterval(fetchData, 10000);
    </script>
  </body>
</html>`;
}


