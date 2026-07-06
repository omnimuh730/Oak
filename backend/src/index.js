import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const PORT = process.env.PORT || 3847;
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, clients: io.engine.clientsCount });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 50e6,
});

const clients = new Map();

io.on('connection', (socket) => {
  const { type = 'unknown', name = 'anonymous' } = socket.handshake.query;
  clients.set(socket.id, { type, name, connectedAt: Date.now() });

  console.log(`[${type}] connected: ${name} (${socket.id})`);

  socket.emit('connected', {
    id: socket.id,
    type,
    clients: getClientSummary(),
  });

  io.emit('clients:update', getClientSummary());

  socket.on('dom:tree', (payload) => {
    const meta = {
      from: socket.id,
      clientType: type,
      clientName: name,
      url: payload?.url ?? 'unknown',
      title: payload?.title ?? 'unknown',
      tabId: payload?.tabId ?? null,
      timestamp: Date.now(),
      nodeCount: countNodes(payload?.tree),
    };

    console.log(`[dom:tree] from ${name} — ${meta.nodeCount} nodes @ ${meta.url}`);

    socket.broadcast.emit('dom:tree', { ...payload, meta });
    socket.emit('dom:tree:sent', meta);
  });

  socket.on('dom:highlight', (payload) => {
    const { extensionId, nodeId, tabId, url } = payload ?? {};
    if (nodeId == null || !tabId) return;

    console.log(`[dom:highlight] nodeId=${nodeId} tab=${tabId}`);

    if (extensionId) {
      io.to(extensionId).emit('dom:highlight', { nodeId, tabId, url });
      return;
    }

    for (const [id, info] of clients.entries()) {
      if (info.type === 'extension') {
        io.to(id).emit('dom:highlight', { nodeId, tabId, url });
      }
    }
  });

  socket.on('disconnect', () => {
    clients.delete(socket.id);
    console.log(`[${type}] disconnected: ${name} (${socket.id})`);
    io.emit('clients:update', getClientSummary());
  });
});

function getClientSummary() {
  return Array.from(clients.entries()).map(([id, info]) => ({ id, ...info }));
}

function countNodes(node) {
  if (!node) return 0;
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);
}

httpServer.listen(PORT, () => {
  console.log(`Oak backend listening on http://localhost:${PORT}`);
});
