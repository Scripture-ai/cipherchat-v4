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

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
    const states = ["disconnected","connected","connecting","disconnecting"];
    res.json({
        status: "ok",
        db: states[mongoose.connection.readyState] || "unknown",
        mongo_uri_set: !!process.env.MONGO_URI,
        time: new Date().toISOString()
    });
});

// ─── MongoDB ──────────────────────────────────────────────────────────────────
if (!process.env.MONGO_URI) {
    console.error("❌ MONGO_URI is not set! Add it in Render environment variables.");
} else {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log("✅ MongoDB connected"))
        .catch(err => console.error("❌ MongoDB error:", err.message));
}

// ─── In-memory state ──────────────────────────────────────────────────────────
const onlineUsers     = {};
const offlineMessages = {};

// ─── Auth routes ──────────────────────────────────────────────────────────────
app.post("/signup", async (req, res) => {
    try {
        console.log("📝 Signup attempt:", req.body?.username);
        const { username, email, password } = req.body;
        if (!username || !email || !password)
            return res.status(400).json({ success: false, message: "All fields required" });

        if (mongoose.connection.readyState !== 1)
            return res.status(503).json({ success: false, message: "Database not connected. Check Render environment variables." });

        const exists = await User.findOne({ $or: [{ username }, { email }] });
        if (exists)
            return res.status(400).json({ success: false, message: "Username or email already taken" });

        const hashed = await bcrypt.hash(password, 12);
        await new User({ username, email, password: hashed }).save();
        console.log("✅ Signup success:", username);
        res.json({ success: true, message: "Account created" });
    } catch (e) {
        console.error("Signup error:", e.message);
        res.status(500).json({ success: false, message: "Signup failed: " + e.message });
    }
});

app.post("/login", async (req, res) => {
    try {
        console.log("🔑 Login attempt:", req.body?.username);
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ success: false, message: "All fields required" });

        if (mongoose.connection.readyState !== 1)
            return res.status(503).json({ success: false, message: "Database not connected. Check Render environment variables." });

        const user = await User.findOne({ username });
        if (!user)
            return res.status(400).json({ success: false, message: "User not found" });

        const match = await bcrypt.compare(password, user.password);
        if (!match)
            return res.status(400).json({ success: false, message: "Wrong password" });

        console.log("✅ Login success:", username);
        res.json({ success: true, username: user.username, email: user.email });
    } catch (e) {
        console.error("Login error:", e.message);
        res.status(500).json({ success: false, message: "Login failed: " + e.message });
    }
});

app.get("/check-user/:username", async (req, res) => {
    const user = await User.findOne({ username: req.params.username }).select("email");
    if (!user) return res.json({ found: false });
    const masked = user.email.replace(/(.{2}).+(@.+)/, "$1***$2");
    res.json({ found: true, maskedEmail: masked });
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
    socket.on("join", (username) => {
        socket.username = username;
        onlineUsers[username] = socket.id;

        if (offlineMessages[username]?.length) {
            offlineMessages[username].forEach(msg => socket.emit("receive-message", msg));
            delete offlineMessages[username];
        }

        io.emit("presence", Object.keys(onlineUsers));
        console.log(`✅ ${username} joined`);
    });

    socket.on("typing", ({ to, isTyping }) => {
        const targetId = onlineUsers[to];
        if (targetId) io.to(targetId).emit("typing", { from: socket.username, isTyping });
    });

    socket.on("send-message", ({ to, message, msgId, timer = 60000, isReply, replyToId }) => {
        const payload = {
            from:      socket.username,
            message,
            msgId,
            timer,
            isReply:   !!isReply,
            replyToId: replyToId || null,
            sentAt:    Date.now()
        };

        if (isReply && replyToId) {
            const originalSenderId = onlineUsers[to];
            if (originalSenderId) io.to(originalSenderId).emit("vanish-message", { msgId: replyToId });
        }

        const targetId = onlineUsers[to];
        if (targetId) {
            io.to(targetId).emit("receive-message", payload);
        } else {
            offlineMessages[to] = offlineMessages[to] || [];
            offlineMessages[to].push(payload);
        }

        socket.emit("message-delivered", { msgId, to });
    });

    socket.on("self-destruct", ({ to, msgId }) => {
        const targetId = onlineUsers[to];
        if (targetId) io.to(targetId).emit("vanish-message", { msgId });
    });

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
server.listen(PORT, () => console.log(`🔐 CipherChat running on port ${PORT}`));