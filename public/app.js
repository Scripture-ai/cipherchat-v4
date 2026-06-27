const socket = io();

let currentUser = "";
let currentPasskey = "";

/* SIGN UP */
async function signup() {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!username || !password) {
        alert("Username and password required");
        return;
    }

    const res = await fetch("/signup", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    alert(data.message);
}

/* LOGIN */
async function login() {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();
    const passkey = document.getElementById("passkey").value.trim();

    if (!username || !password || !passkey) {
        alert("Username, password and passkey required");
        return;
    }

    const res = await fetch("/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (data.message === "Login successful") {
        currentUser = username;

        // Important: set passkey before loading history
        currentPasskey = passkey;

        // Switch UI
        document.getElementById("auth-box").style.display = "none";
        document.getElementById("chat-box").style.display = "block";

        // Show username
        document.getElementById("current-user").innerText = username;

        // Join socket
        socket.emit("join", username);

        // Load old messages after passkey is ready
        socket.emit("load-history", username);

    } else {
        alert(data.message);
    }
}

/* LOGOUT */
function logout() {
    currentUser = "";
    currentPasskey = "";

    document.getElementById("messages").innerHTML = "";

    document.getElementById("chat-box").style.display = "none";
    document.getElementById("auth-box").style.display = "block";
}

/* SEND MESSAGE */
async function sendMessage() {
    const receiver = document.getElementById("receiver").value.trim();
    const message = document.getElementById("message").value.trim();

    if (!receiver || !message || !currentPasskey) {
        alert("Receiver, passkey and message required");
        return;
    }

    try {
        const cipherText = await encryptMessage(
            message,
            currentPasskey
        );

        socket.emit("secure-message", {
            sender: currentUser,
            receiver,
            cipherText
        });

        // Show own message instantly
        addMessage("You", message);

        document.getElementById("message").value = "";

    } catch (error) {
        console.error("Encryption failed:", error);
    }
}

/* RECEIVE LIVE MESSAGE */
socket.on("receive-message", async (data) => {
    try {
        if (!currentPasskey) {
            alert("Passkey missing. Cannot decrypt.");
            return;
        }

        const plain = await decryptMessage(
            data.cipherText,
            currentPasskey
        );

        addMessage(data.sender, plain);

    } catch (error) {
        console.log("Failed to decrypt live message");
    }
});

/* LOAD HISTORY */
socket.on("history", async (messages) => {
    const messagesBox = document.getElementById("messages");
    messagesBox.innerHTML = "";

    for (let msg of messages) {
        try {
            const plain = await decryptMessage(
                msg.cipherText,
                currentPasskey
            );

            addMessage(msg.sender, plain);

        } catch {
            console.log("Skipped undecryptable history");
        }
    }
});

/* PRESENCE */
socket.on("presence", (users) => {
    document.getElementById("online-users").innerText =
        "Online: " + users.join(", ");
});

/* ADD MESSAGE TO UI */
function addMessage(sender, text) {
    const div = document.createElement("div");
    div.className = "message";

    div.innerHTML = `
        <strong>${sender}</strong><br>
        ${text}
    `;

    document.getElementById("messages").appendChild(div);

    // Auto-scroll
    const box = document.getElementById("messages");
    box.scrollTop = box.scrollHeight;
}