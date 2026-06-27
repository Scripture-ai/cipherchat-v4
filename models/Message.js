const mongoose = require("mongoose");

module.exports = mongoose.model("Message", new mongoose.Schema({
    sender: String,
    receiver: String,
    cipherText: Object,
    selfDestruct: Number,
    readAt: Date,
    createdAt: {
        type: Date,
        default: Date.now
    }
}));