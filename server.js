const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const path = require("path");
require("dotenv").config();

const User = require("./models/User");

const app = express();
const server = http.createServer(app);

const io = socketIo(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB connected"))
    .catch(err => console.log("MongoDB error:", err));

const onlineUsers = {};
const offlineMessages = {};

app.post("/signup", async (req, res) => {
    try {
        const { username, email, password } = req.body;

        const existing = await User.findOne({
            $or: [{ username }, { email }]
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                message: "User already exists"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            username,
            email,
            password: hashedPassword
        });

        await newUser.save();

        res.json({
            success: true,
            message: "Signup successful"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Signup failed"
        });
    }
});

app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await User.findOne({ username });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: "User not found"
            });
        }

        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.status(400).json({
                success: false,
                message: "Wrong password"
            });
        }

        res.json({
            success: true,
            message: "Login successful"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Login failed"
        });
    }
});

io.on("connection", (socket) => {
    console.log("New connection:", socket.id);

    socket.on("join", (username) => {
        socket.username = username;
        onlineUsers[username] = socket.id;

        console.log(`${username} joined`);

        if (offlineMessages[username]) {
            offlineMessages[username].forEach(msg => {
                socket.emit("receive-message", msg);
            });

            delete offlineMessages[username];
        }

        io.emit("presence", Object.keys(onlineUsers));
    });

    socket.on("send-message", ({ to, message, timer }) => {
        const payload = {
            from: socket.username,
            message,
            timer
        };

        if (onlineUsers[to]) {
            io.to(onlineUsers[to]).emit("receive-message", payload);
        } else {
            if (!offlineMessages[to]) {
                offlineMessages[to] = [];
            }

            offlineMessages[to].push(payload);
        }
    });

    socket.on("disconnect", () => {
        if (socket.username) {
            delete onlineUsers[socket.username];
            io.emit("presence", Object.keys(onlineUsers));
        }

        console.log("Disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
    console.log(`CipherChat running on port ${PORT}`);
});