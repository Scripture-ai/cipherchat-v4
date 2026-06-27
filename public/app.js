const socket = io();

let username = "";
let passkey = "";

function signup() {
    const user = document.getElementById("username").value;
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    fetch("/signup", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username: user,
            email,
            password
        })
    })
    .then(res => res.json())
    .then(data => {
        alert(data.message);
    });
}

function login() {
    const user = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    fetch("/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            username: user,
            password
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            username = user;

            localStorage.setItem("cipherUser", username);

            document.getElementById("loginScreen").classList.add("hidden");
            document.getElementById("chatScreen").classList.remove("hidden");

            setPasskey();

            socket.emit("join", username);
        } else {
            alert(data.message);
        }
    });
}

function setPasskey() {
    const key = prompt("Enter secure channel passkey:");

    if (!key) {
        alert("Passkey required");
        return;
    }

    passkey = key;
}

function send() {
    const recipient = document.getElementById("recipient").value;
    const messageInput = document.getElementById("message");
    const timer = document.getElementById("timer").value;

    if (!recipient || !messageInput.value) return;

    const encrypted = encrypt(messageInput.value, passkey);

    socket.emit("send-message", {
        to: recipient,
        message: encrypted,
        timer
    });

    addMessage(`You: ${messageInput.value}`);

    messageInput.value = "";
}

socket.on("receive-message", (data) => {
    if (!passkey) {
        alert("Set passkey first");
        return;
    }

    try {
        const decrypted = decrypt(data.message, passkey);

        addMessage(`${data.from}: ${decrypted}`);

        if (data.timer) {
            setTimeout(() => {
                const messages = document.getElementById("messages");
                if (messages.lastChild) {
                    messages.removeChild(messages.lastChild);
                }
            }, data.timer * 1000);
        }
    } catch {
        addMessage(`${data.from}: [Wrong passkey]`);
    }
});

socket.on("presence", (users) => {
    document.getElementById("presence").innerText =
        "Online: " + users.join(", ");
});

function addMessage(text) {
    const msg = document.createElement("div");
    msg.className = "msg";
    msg.innerText = text;

    document.getElementById("messages").appendChild(msg);
}

function logout() {
    localStorage.clear();
    location.reload();
}

function panic() {
    localStorage.clear();
    document.getElementById("messages").innerHTML = "";
    location.reload();
}