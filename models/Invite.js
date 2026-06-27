const mongoose = require("mongoose");

module.exports = mongoose.model("Invite", new mongoose.Schema({
    code: String,
    username: String,
    expiresAt: Date
}));