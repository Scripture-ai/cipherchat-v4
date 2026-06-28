const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    username:        { type: String, required: true, unique: true, trim: true },
    email:           { type: String, required: true, unique: true, trim: true },
    password:        { type: String, required: true },
    resetToken:      { type: String, default: null },
    resetTokenExpiry:{ type: Date,   default: null },
    createdAt:       { type: Date,   default: Date.now }
});

module.exports = mongoose.model("User", userSchema);