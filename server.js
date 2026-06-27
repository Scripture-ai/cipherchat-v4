require("dotenv").config();

const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { Server } = require("socket.io");

const User = require("./models/User");
const Message = require("./models/Message");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.static("public"));

// Root route
app.get("/", (req, res) => {
    res.sendFile(__dirname + "/public/index.html");
});

// MongoDB connect
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB connected"))
.catch((err) => console.log("MongoDB error:", err));

// Store online users
let onlineUsers = {};

/* SIGNUP */
app.post("/signup", async (req, res) => {
    try {
        const { username, password } = req.body;

        const existingUser = await User.findOne({ username });

        if (existingUser) {
            return res.status(400).json({
                message: "Username already exists"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await User.create({
            username,
            password: hashedPassword
        });

        res.json({
            message: "Signup successful"
        });

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Signup failed"
        });
    }
});

/* LOGIN */
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await User.findOne({ username });

        if (!user) {
            return res.status(400).json({
                message: "User not found"
            });
        }

        const validPassword = await bcrypt.compare(
            password,
            user.password
        );

        if (!validPassword) {
            return res.status(400).json({
                message: "Invalid password"
            });
        }

        res.json({
            message: "Login successful"
        });

    } catch (error) {
        console.log(error);

        res.status(500).json({
            message: "Login failed"
        });
    }
});

/* SOCKETS */
io.on("connection", (socket) => {
    console.log("New connection:", socket.id);

    // Join user
    socket.on("join", (username) => {
        onlineUsers[username] = socket.id;

        console.log(`${username} joined`);

        io.emit("presence", Object.keys(onlineUsers));
    });

    // Secure message
    socket.on("secure-message", async (data) => {
        try {
            const { sender, receiver, cipherText } = data;

            console.log("Message:", sender, "->", receiver);

            // Save in DB
            await Message.create({
                sender,
                receiver,
                cipherText
            });

            // Deliver live if online
            if (onlineUsers[receiver]) {
                io.to(onlineUsers[receiver]).emit(
                    "receive-message",
                    data
                );
            }

        } catch (error) {
            console.log("Message error:", error);
        }
    });

    // Load old messages
    socket.on("load-history", async (username) => {
        try {
            const history = await Message.find({
                $or: [
                    { sender: username },
                    { receiver: username }
                ]
            }).sort({ createdAt: 1 });

            socket.emit("history", history);

        } catch (error) {
            console.log("History error:", error);
        }
    });

    // Disconnect
    socket.on("disconnect", () => {
        console.log("Disconnected:", socket.id);

        for (let username in onlineUsers) {
            if (onlineUsers[username] === socket.id) {
                delete onlineUsers[username];
                break;
            }
        }

        io.emit("presence", Object.keys(onlineUsers));
    });
});

// Start server
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`CipherChat running on port ${PORT}`);
});