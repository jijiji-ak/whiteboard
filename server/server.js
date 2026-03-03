const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const ALLOWED_ORIGIN = process.env.CLIENT_ORIGIN || '*';

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

app.use(cors({ origin: ALLOWED_ORIGIN }));

// Drawing history: array of segment events and clear markers
let drawingHistory = [];
const MAX_HISTORY = 20000;

app.get('/', (_req, res) => {
  res.json({ status: 'ok', connections: io.engine.clientsCount });
});

const broadcastUserCount = () => {
  io.emit('user_count', io.engine.clientsCount);
};

io.on('connection', (socket) => {
  console.log(`[+] connected: ${socket.id} (total: ${io.engine.clientsCount})`);
  broadcastUserCount();

  // Send current drawing history to new user so they see existing work
  socket.emit('history', drawingHistory);

  socket.on('draw', (data) => {
    // Minimal validation
    if (
      typeof data.x0 !== 'number' ||
      typeof data.y0 !== 'number' ||
      typeof data.x1 !== 'number' ||
      typeof data.y1 !== 'number'
    ) {
      return;
    }

    drawingHistory.push({ type: 'draw', ...data });
    if (drawingHistory.length > MAX_HISTORY) {
      drawingHistory = drawingHistory.slice(-MAX_HISTORY);
    }

    socket.broadcast.emit('draw', data);
  });

  // clear only removes draw events; background image stays
  socket.on('clear', () => {
    drawingHistory = drawingHistory.filter((e) => e.type !== 'draw');
    socket.broadcast.emit('clear');
  });

  socket.on('place_image', (base64) => {
    if (typeof base64 !== 'string' || !base64.startsWith('data:image/')) return;
    // Keep only the latest image event (replace previous)
    drawingHistory = drawingHistory.filter((e) => e.type !== 'place_image');
    drawingHistory.push({ type: 'place_image', data: base64 });
    socket.broadcast.emit('place_image', base64);
  });

  socket.on('remove_bg', () => {
    drawingHistory = drawingHistory.filter((e) => e.type !== 'place_image');
    socket.broadcast.emit('remove_bg');
  });

  socket.on('disconnect', () => {
    console.log(`[-] disconnected: ${socket.id}`);
    broadcastUserCount();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Whiteboard server listening on port ${PORT}`);
});
