import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import { TexasHoldemRoom } from './pokerEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Serve static frontend in production
app.use(express.static(path.join(__dirname, '../client/dist')));

// Find local IP address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIpAddress();
const PORT = process.env.PORT || 3000;

// Rooms store: roomCode -> TexasHoldemRoom
const rooms = new Map();

// Helper to generate 4-character room codes
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

// REST Endpoints
app.get('/api/server-info', async (req, res) => {
  const localUrl = `http://${localIp}:${PORT}`;
  try {
    const qrDataUrl = await QRCode.toDataURL(localUrl);
    res.json({
      localIp,
      port: PORT,
      url: localUrl,
      qr: qrDataUrl
    });
  } catch (err) {
    res.json({ localIp, port: PORT, url: localUrl });
  }
});

// Socket.io handlers
io.on('connection', (socket) => {
  console.log(`[Socket Connected] ${socket.id}`);

  // Create room
  socket.on('create_room', ({ playerName, avatar, config }, callback) => {
    const roomCode = generateRoomCode();
    const hostPlayer = {
      id: socket.id,
      name: playerName || 'Хост',
      avatar: avatar || 1
    };

    const room = new TexasHoldemRoom(roomCode, hostPlayer, config);
    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.roomCode = roomCode;

    console.log(`[Room Created] ${roomCode} by ${hostPlayer.name}`);
    callback({ success: true, roomCode, state: room.getPublicState(socket.id) });
  });

  // Join room
  socket.on('join_room', ({ roomCode, playerName, avatar }, callback) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      return callback({ success: false, error: 'Комната с таким кодом не найдена!' });
    }

    const player = {
      id: socket.id,
      name: playerName || `Игрок`,
      avatar: avatar || Math.floor(Math.random() * 8) + 1
    };

    const added = room.addPlayer(player);
    if (!added) {
      return callback({ success: false, error: 'Стол полон или игрок уже в игре!' });
    }

    socket.join(code);
    socket.roomCode = code;

    console.log(`[Player Joined] ${player.name} -> ${code}`);
    callback({ success: true, roomCode: code, state: room.getPublicState(socket.id) });

    // Broadcast updated state to room
    broadcastRoomState(room);
  });

  // Update room settings (only host)
  socket.on('update_config', (newConfig) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id || room.state !== 'LOBBY') return;

    room.config = { ...room.config, ...newConfig };
    // update players chips if changed
    if (newConfig.startingChips) {
      for (const p of room.players) {
        p.chips = newConfig.startingChips;
      }
    }
    broadcastRoomState(room);
  });

  // Start game (only host)
  socket.on('start_game', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return;

    room.startHand();
    broadcastRoomState(room);
  });

  // Player action (fold, check, call, raise)
  socket.on('action', ({ action, amount }) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;

    const ok = room.handleAction(socket.id, action, amount);
    if (ok) {
      broadcastRoomState(room);
    }
  });

  // Manual trigger of mat reaction by player button
  socket.on('send_reaction', ({ matText }) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.reaction = matText;
      room.addLog(`${player.name}: "${matText}"`);
      broadcastRoomState(room);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[Socket Disconnected] ${socket.id}`);
    if (socket.roomCode) {
      const room = rooms.get(socket.roomCode);
      if (room) {
        room.removePlayer(socket.id);
        if (room.players.length === 0) {
          rooms.delete(socket.roomCode);
          console.log(`[Room Deleted] ${socket.roomCode}`);
        } else {
          // If host left, assign new host
          if (room.hostId === socket.id) {
            room.hostId = room.players[0].id;
          }
          broadcastRoomState(room);
        }
      }
    }
  });
});

function broadcastRoomState(room) {
  for (const p of room.players) {
    io.to(p.id).emit('room_state', room.getPublicState(p.id));
  }
}

// Listen
server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🔥 POKER TEXAS HOLD'EM SERVER STARTED! 🔥`);
  console.log(`Локальный доступ: http://localhost:${PORT}`);
  console.log(`Доступ по Wi-Fi / телефону: http://${localIp}:${PORT}`);
  console.log(`===============================================`);
});
