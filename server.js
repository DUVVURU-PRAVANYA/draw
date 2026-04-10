// Air Draw — Multiplayer server  (Node.js + Socket.IO)
// Start:         node server.js
// Vite dev:      npm run dev   (separate terminal)

import { createServer } from 'http';
import { Server }       from 'socket.io';

const PORT = 3001;

const httpServer = createServer((req, res) => {
  // Basic health-check endpoint — useful for debugging connectivity
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // Keep-alive ping to avoid idle disconnects
  pingInterval: 10000,
  pingTimeout:  5000
});

// room → Set<socketId>
const rooms = new Map();

// ── Helpers ────────────────────────────────────────────────────────────────
function getRoomCount(room) {
  return rooms.get(room)?.size ?? 0;
}

function leaveRoom(socket, room) {
  if (!rooms.has(room)) return;
  rooms.get(room).delete(socket.id);
  if (rooms.get(room).size === 0) rooms.delete(room);
}

// ── Connection handling ─────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // ── Join room ────────────────────────────────────────────────────────────
  socket.on('joinRoom', ({ room = 'default' } = {}) => {
    // Leave any existing rooms first
    for (const r of socket.rooms) {
      if (r !== socket.id) {
        socket.leave(r);
        leaveRoom(socket, r);
        socket.to(r).emit('roomUpdate', { count: getRoomCount(r), room: r });
        socket.to(r).emit('remoteCursorLeave', { id: socket.id });
      }
    }

    socket.join(room);
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(socket.id);

    const count = getRoomCount(room);
    console.log(`    ${socket.id} → "${room}" (${count} users)`);

    io.to(room).emit('roomUpdate', { count, room });
    socket.emit('joined', { room, id: socket.id });
  });

  // ── Live draw point (streamed per frame) ────────────────────────────────
  socket.on('draw', ({ room = 'default', ...data }) => {
    socket.to(room).emit('remoteDraw', { id: socket.id, ...data });
  });

  // ── Completed stroke (emitted when gesture ends) ─────────────────────────
  socket.on('stroke', ({ room = 'default', ...data }) => {
    socket.to(room).emit('remoteStroke', data);
  });

  // ── Erase brush point ────────────────────────────────────────────────────
  socket.on('erase', ({ room = 'default', x, y }) => {
    socket.to(room).emit('remoteErase', { id: socket.id, x, y });
  });

  // ── Full clear ───────────────────────────────────────────────────────────
  socket.on('clear', ({ room = 'default' } = {}) => {
    console.log(`    [clear] ${socket.id} in "${room}"`);
    socket.to(room).emit('remoteClear');
  });

  // ── Cursor position (throttled on client) ────────────────────────────────
  socket.on('cursor', ({ room = 'default', ...pos }) => {
    socket.to(room).emit('remoteCursor', { id: socket.id, ...pos });
  });

  // ── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room === socket.id) continue;
      leaveRoom(socket, room);
      const count = getRoomCount(room);
      socket.to(room).emit('roomUpdate', { count, room });
      socket.to(room).emit('remoteCursorLeave', { id: socket.id });
    }
  });

  socket.on('disconnect', () => console.log(`[-] ${socket.id}`));
});

// ── Start ───────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║   🚀  Air Draw Multiplayer Server     ║
║       Listening on :${PORT}             ║
║       Health: http://localhost:${PORT}/health ║
╚═══════════════════════════════════════╝
  `);
  console.log('Run "npm run dev" in a separate terminal for the Vite dev server.\n');
});
