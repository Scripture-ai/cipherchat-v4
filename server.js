const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const User = require("./models/User");

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
    cors: { origin: "*" },
    pingTimeout: 60000
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   HEALTH
========================= */
app.get("/health", (req, res) => {
    const states = [
        "disconnected",
        "connected",
        "connecting",
        "disconnecting"
    ];

    res.json({
        status: "ok",
        db: states[mongoose.connection.readyState] || "unknown",
        time: new Date().toISOString()
    });
});

/* =========================
   DATABASE
========================= */
if (!process.env.MONGO_URI) {
    console.error("❌ MONGO_URI missing");
} else {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log("✅ MongoDB connected"))
        .catch(err => console.error("Mongo error:", err.message));
}

/* =========================
   MEMORY
========================= */
const onlineUsers = {};
const offlineMessages = {};
const groups = {};
const lastSeen = {};

/* =========================
   SIGNUP
========================= */
app.post("/signup", async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.json({
                success: false,
                message: "All fields required"
            });
        }

        const exists = await User.findOne({
            $or: [{ username }, { email }]
        });

        if (exists) {
            return res.json({
                success: false,
                message: "User already exists"
            });
        }

        const hashed = await bcrypt.hash(password, 12);

        await new User({
            username,
            email,
            password: hashed
        }).save();

        res.json({
            success: true,
            message: "Account created"
        });

    } catch (err) {
        res.json({
            success: false,
            message: err.message
        });
    }
});

/* =========================
   LOGIN
========================= */
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await User.findOne({ username });

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.json({
                success: false,
                message: "Wrong passkey"
            });
        }

        res.json({
            success: true,
            username: user.username,
            email: user.email
        });

    } catch (err) {
        res.json({
            success: false,
            message: err.message
        });
    }
});

/* =========================
   FORGOT PASSWORD
========================= */
app.post("/forgot-password", async (req, res) => {
    try {
        const { username } = req.body;

        const user = await User.findOne({ username });

        if (!user) {
            return res.json({
                success: false,
                message: "User not found"
            });
        }

        const token = crypto.randomBytes(32).toString("hex");

        user.resetToken = token;
        user.resetTokenExpiry = new Date(Date.now() + 3600000);

        await user.save();

        res.json({
            success: true,
            token
        });

    } catch (err) {
        res.json({
            success: false,
            message: err.message
        });
    }
});

/* =========================
   RESET PASSWORD
========================= */
app.post("/reset-password", async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        const user = await User.findOne({
            resetToken: token,
            resetTokenExpiry: { $gt: Date.now() }
        });

        if (!user) {
            return res.json({
                success: false,
                message: "Invalid or expired token"
            });
        }

        user.password = await bcrypt.hash(newPassword, 12);
        user.resetToken = null;
        user.resetTokenExpiry = null;

        await user.save();

        res.json({
            success: true,
            message: "Password reset successful"
        });

    } catch (err) {
        res.json({
            success: false,
            message: err.message
        });
    }
});

/* =========================
   CHECK USER
========================= */
app.get("/check-user/:username", async (req, res) => {
    const user = await User.findOne({
        username: req.params.username
    }).select("email");

    if (!user) {
        return res.json({ found: false });
    }

    const maskedEmail =
        user.email.replace(/(.{2}).+(@.+)/, "$1***$2");

    res.json({
        found: true,
        maskedEmail
    });
});

/* =========================
   SOCKET
========================= */
io.on("connection", (socket) => {

    /* JOIN */
    socket.on("join", (username) => {
        socket.username = username;
        onlineUsers[username] = socket.id;

        if (offlineMessages[username]?.length) {
            const queue = offlineMessages[username];
            delete offlineMessages[username];

            queue.forEach(msg => {
                socket.emit("receive-message", msg);

                const senderSocket = onlineUsers[msg.from];
                if (senderSocket) {
                    io.to(senderSocket).emit("message-delivered", {
                        msgId: msg.msgId
                    });
                }
            });
        }

        io.emit("presence", Object.keys(onlineUsers));
    });

    /* TYPING */
    socket.on("typing", ({ to, isTyping }) => {
        const target = onlineUsers[to];
        if (target) {
            io.to(target).emit("typing", {
                from: socket.username,
                isTyping
            });
        }
    });

    /* SEND MESSAGE */
    socket.on("send-message", ({
        to,
        message,
        msgId,
        timer,
        isReply,
        replyToId
    }) => {

        const payload = {
            from: socket.username,
            message,
            msgId,
            timer,
            isReply: !!isReply,
            replyToId: replyToId || null,
            sentAt: Date.now()
        };

        if (isReply && replyToId) {
            const target = onlineUsers[to];
            if (target) {
                io.to(target).emit("vanish-message", {
                    msgId: replyToId
                });
            }
        }

        const target = onlineUsers[to];

        if (target) {
            io.to(target).emit("receive-message", payload);

            socket.emit("message-delivered", {
                msgId
            });
        } else {
            if (!offlineMessages[to]) {
                offlineMessages[to] = [];
            }

            offlineMessages[to].push(payload);
        }
    });

    /* REQUEST KEY */
    socket.on("request-key", ({ to, msgId }) => {
        const target = onlineUsers[to];

        if (target) {
            io.to(target).emit("key-request", {
                from: socket.username,
                msgId
            });
        }
    });

    /* SHARE KEY */
    socket.on("share-passcode", ({
        to,
        passcode,
        msgId
    }) => {
        const target = onlineUsers[to];

        if (target) {
            io.to(target).emit("passcode-share", {
                from: socket.username,
                passcode,
                msgId
            });
        }
    });

    /* CREATE GROUP */
    socket.on("create-group", ({
        groupName,
        members
    }) => {
        if (!groups[groupName]) {
            groups[groupName] = {
                creator: socket.username,
                members
            };
        }
    });

    /* GROUP MESSAGE */
    socket.on("send-group-message", ({
        groupName,
        message,
        msgId
    }) => {
        const group = groups[groupName];

        if (!group) return;

        group.members.forEach(member => {
            const target = onlineUsers[member];

            if (target && member !== socket.username) {
                io.to(target).emit("receive-group-message", {
                    from: socket.username,
                    groupName,
                    message,
                    msgId,
                    sentAt: Date.now()
                });
            }
        });
    });

    /* SEEN */
    socket.on("message-seen", ({ to, msgId }) => {
        const target = onlineUsers[to];

        if (target) {
            io.to(target).emit("message-seen-update", {
                msgId
            });
        }
    });

    /* DISCONNECT */
    socket.on("disconnect", () => {
        if (socket.username) {
            delete onlineUsers[socket.username];
            lastSeen[socket.username] = Date.now();

            io.emit("presence", Object.keys(onlineUsers));
        }
    });

});

/* =========================
   START
========================= */
const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
    console.log(`🔐 CipherChat running on ${PORT}`);
});