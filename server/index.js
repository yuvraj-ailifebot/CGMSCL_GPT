const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const chatSessionSchema = new mongoose.Schema(
  {
    actor_id: { type: String, required: true, index: true },
    session_id: { type: String, required: true, index: true },
    title: { type: String, default: 'New Chat' },
    backendType: { type: String, default: 'AWS' },
    messages: { type: Array, default: [] },
    updated_at: { type: Date, default: Date.now }
  },
  { timestamps: true }
);
chatSessionSchema.index({ actor_id: 1, session_id: 1 }, { unique: true });

const feedbackSchema = new mongoose.Schema(
  {
    actor_id: { type: String, required: true },
    session_id: { type: String, required: true },
    message_index: { type: Number, required: true },
    type: { type: String, enum: ['like', 'dislike', 'suggest'], required: true },
    reasons: { type: [String], default: [] },
    comment: { type: String, default: '' }
  },
  { timestamps: true }
);

const ChatSession = mongoose.model('ChatSession', chatSessionSchema);
const Feedback = mongoose.model('Feedback', feedbackSchema);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/api/sessions/upsert', async (req, res) => {
  try {
    const { actor_id, session_id, title, backendType, messages } = req.body;
    if (!actor_id || !session_id) {
      return res.status(400).json({ error: 'actor_id and session_id are required' });
    }

    const updated = await ChatSession.findOneAndUpdate(
      { actor_id, session_id },
      {
        actor_id,
        session_id,
        title: title || 'New Chat',
        backendType: backendType || 'AWS',
        messages: Array.isArray(messages) ? messages : [],
        updated_at: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({ success: true, session: updated });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const actorId = req.query.actor_id;
    if (!actorId) return res.status(400).json({ error: 'actor_id is required' });

    const sessions = await ChatSession.find({ actor_id: actorId })
      .sort({ updated_at: -1 })
      .lean();
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sessions/delete', async (req, res) => {
  try {
    const { actor_id, session_id } = req.body || {};
    if (!actor_id || !session_id) {
      return res.status(400).json({ error: 'actor_id and session_id are required' });
    }
    await ChatSession.deleteOne({ actor_id, session_id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const payload = req.body || {};
    const doc = await Feedback.create(payload);
    res.json({ success: true, feedback: doc });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function start() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is required in server/.env');
  }
  await mongoose.connect(uri);
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Mongo server running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});
