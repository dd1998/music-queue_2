const express = require('express');
const cors = require('cors');
const app = express();
const cheerio = require('cheerio');
const fetch = require('node-fetch');
const WebSocket = require('ws');

app.use(cors());
app.use(express.json());

const SHEET_BEST_API = 'https://sheet.best/api/sheets/e8f1dc6e-1e01-4489-80bc-ae6afb397660';

// สร้าง WebSocket Server
const wss = new WebSocket.Server({ noServer: true });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connected');

  ws.on('close', () => {
    clients.delete(ws); // ✅ แก้ตรงนี้จาก .remove เป็น .delete
    console.log('Client disconnected');
  });
});

// แจ้งเตือน client ทั้งหมด
function broadcastUpdate() {
  const message = JSON.stringify({ type: 'queue_updated' });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// เพิ่มเพลงลง Google Sheet
app.post('/api/add', async (req, res) => {
  const video = req.body;
  if (!video || !video.videoId || !video.title) {
    return res.status(400).json({ error: 'Missing videoId or title' });
  }

  try {
    const response = await fetch(SHEET_BEST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: video.videoId,
        title: video.title,
        thumbnail: video.thumbnail || '',
        status: '0',
        timestamp: ''
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: 'Failed to add song', detail: text });
    }

    const data = await response.json();
    broadcastUpdate();
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error adding song:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// อัปเดตสถานะเพลง (เช่น ข้ามเพลงแล้ว)
app.put('/api/update-status', async (req, res) => {
  const { videoId } = req.body;

  if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

  try {
    const url = `${SHEET_BEST_API}/videoId/${videoId}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: '1',
        timestamp: new Date().toISOString()
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: 'Failed to update status', detail: text });
    }

    const data = await response.json();
    broadcastUpdate();
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error updating status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ลบเพลงออกจากคิว
app.delete('/api/remove', async (req, res) => {
  const videoId = req.query.videoId;
  if (!videoId) {
    return res.status(400).json({ error: 'Missing videoId query parameter' });
  }

  try {
    const url = `${SHEET_BEST_API}/videoId/${videoId}`;
    const response = await fetch(url, { method: 'DELETE' });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: 'Failed to delete song', detail: text });
    }

    broadcastUpdate();
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting song:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ดึงรายการเพลงทั้งหมดในคิว (ที่ยังไม่ถูกเล่น)
app.get('/api/queue', async (req, res) => {
  try {
    const response = await fetch(SHEET_BEST_API);
    if (!response.ok) throw new Error('Failed to fetch queue');

    const data = await response.json();
    const queue = data.filter(song => song.status === '0');

    res.json({ queue });
  } catch (err) {
    console.error('Error fetching queue:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ค้นหา YouTube (แบบง่าย)
app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Missing search query' });

  try {
    const response = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
    const html = await response.text();
    const $ = cheerio.load(html);
    const scripts = $('script');

    let ytInitialData = null;

    scripts.each((i, el) => {
      const content = $(el).html();
      if (content && content.includes('ytInitialData')) {
        const jsonStrMatch = content.match(/ytInitialData\s*=\s*(\{.*\});/s);
        if (jsonStrMatch && jsonStrMatch[1]) {
          try {
            ytInitialData = JSON.parse(jsonStrMatch[1]);
          } catch (e) {
            console.error('JSON parse error:', e);
          }
        }
      }
    });

    if (!ytInitialData) throw new Error('Failed to parse YouTube data');

    const videos = [];
    const items = ytInitialData.contents
      ?.twoColumnSearchResultsRenderer
      ?.primaryContents
      ?.sectionListRenderer
      ?.contents || [];

    items.forEach(section => {
      const videoItems = section.itemSectionRenderer?.contents || [];
      videoItems.forEach(item => {
        const video = item.videoRenderer;
        if (video) {
          videos.push({
            videoId: video.videoId,
            title: video.title?.runs?.[0]?.text || '',
            thumbnail: video.thumbnail?.thumbnails?.[0]?.url || '',
          });
        }
      });
    });

    res.json({ results: videos });
  } catch (err) {
    console.error('Error searching YouTube:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});
app.post('/api/played', async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) return res.status(400).send({ error: 'Missing videoId' });

  try {
    // ลบเพลงหรืออัปเดตสถานะใน DB
    await queueCollection.deleteOne({ videoId }); // ตัวอย่าง

    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ error: 'Server error' });
  }
});
// สร้าง HTTP server และผูกกับ WebSocket
const server = app.listen(5000, '192.168.20.111', () => {
  console.log('Server running on http://192.168.20.111:5000');
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
