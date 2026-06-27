const express = require("express");
const http    = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const bcrypt   = require("bcrypt");
const path     = require("path");
require("dotenv").config();

const User = require("./models/User");

const app    = express();
const server = http.createServer(app);
const io     = socketIo(server, {
    cors: { origin: "*" },
    pingTimeout: 60000
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB connected"))
    .catch(err => console.error("❌ MongoDB error:", err));

// ─── In-memory state ──────────────────────────────────────────────────────────
const onlineUsers     = {};   // username → socket.id
const offlineMessages = {};   // username → [payload, ...]
// Track which message IDs have been replied to (for vanish-on-reply)
// key: `${from}:${to}:${msgId}`, value: true
const repliedMessages = new Set();

// ─── Auth routes ──────────────────────────────────────────────────────────────
app.post("/signup", async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password)
            return res.status(400).json({ success: false, message: "All fields required" });

        const exists = await User.findOne({ $or: [{ username }, { email }] });
        if (exists)
            return res.status(400).json({ success: false, message: "Username or email already taken" });

        const hashed = await bcrypt.hash(password, 12);
        await new User({ username, email, password: hashed }).save();
        res.json({ success: true, message: "Account created" });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: "Signup failed" });
    }
});

app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user)
            return res.status(400).json({ success: false, message: "User not found" });

        const match = await bcrypt.compare(password, user.password);
        if (!match)
            return res.status(400).json({ success: false, message: "Wrong password" });

        res.json({ success: true, username: user.username, email: user.email });
    } catch (e) {
        res.status(500).json({ success: false, message: "Login failed" });
    }
});

// Check if username exists (for recovery hint)
app.get("/check-user/:username", async (req, res) => {
    const user = await User.findOne({ username: req.params.username }).select("email");
    if (!user) return res.json({ found: false });
    const masked = user.email.replace(/(.{2}).+(@.+)/, "$1***$2");
    res.json({ found: true, maskedEmail: masked });
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
    // ── join ──────────────────────────────────────────────────────────────────
    socket.on("join", (username) => {
        socket.username = username;
        onlineUsers[username] = socket.id;

        // Deliver any queued offline messages
        if (offlineMessages[username]?.length) {
            offlineMessages[username].forEach(msg => socket.emit("receive-message", msg));
            delete offlineMessages[username];
        }

        io.emit("presence", Object.keys(onlineUsers));
        console.log(`✅ ${username} joined`);
    });

    // ── typing indicator ──────────────────────────────────────────────────────
    socket.on("typing", ({ to, isTyping }) => {
        const targetId = onlineUsers[to];
        if (targetId) {
            io.to(targetId).emit("typing", { from: socket.username, isTyping });
        }
    });

    // ── send message ──────────────────────────────────────────────────────────
    // payload: { to, message (encrypted), msgId, timer (ms, default 60000), isReply, replyToId }
    socket.on("send-message", ({ to, message, msgId, timer = 60000, isReply, replyToId }) => {
        const payload = {
            from:      socket.username,
            message,          // already AES-encrypted on client
            msgId,
            timer,
            isReply:   !!isReply,
            replyToId: replyToId || null,
            sentAt:    Date.now()
        };

        // If this is a reply, mark the original message for vanish on the SENDER's side
        if (isReply && replyToId) {
            const originalSenderId = onlineUsers[to];
            if (originalSenderId) {
                io.to(originalSenderId).emit("vanish-message", { msgId: replyToId });
            }
        }

        const targetId = onlineUsers[to];
        if (targetId) {
            io.to(targetId).emit("receive-message", payload);
        } else {
            offlineMessages[to] = offlineMessages[to] || [];
            offlineMessages[to].push(payload);
        }

        // Echo delivery confirmation to sender
        socket.emit("message-delivered", { msgId, to });
    });

    // ── explicit vanish (self-destruct ack from client) ────────────────────────
    socket.on("self-destruct", ({ to, msgId }) => {
        const targetId = onlineUsers[to];
        if (targetId) {
            io.to(targetId).emit("vanish-message", { msgId });
        }
    });

    // ── disconnect ────────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
        if (socket.username) {
            delete onlineUsers[socket.username];
            io.emit("presence", Object.keys(onlineUsers));
            console.log(`⚪ ${socket.username} left`);
        }
    });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`🔐 CipherChat v3 running on port ${PORT}`));