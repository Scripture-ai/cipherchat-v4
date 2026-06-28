const socket = io();

/* =========================
   GLOBAL STATE
========================= */
let currentUser = "";
let currentPeer = "";
let currentPasskey = "";
let replyTarget = null;
let incomingKeyRequest = null;
let groups = JSON.parse(localStorage.getItem("cipher_groups") || "[]");

/* =========================
   DOM HELPERS
========================= */
const $ = (id) => document.getElementById(id);

function toast(message) {
    const wrap = $("toast-wrap");
    const el = document.createElement("div");
    el.className = "toast";
    el.innerText = message;
    wrap.appendChild(el);

    setTimeout(() => {
        el.remove();
    }, 3500);
}

/* =========================
   BASIC ENCRYPTION
========================= */
function encrypt(text, key) {
    return btoa(`${key}:${text}`);
}

function decrypt(text, key) {
    const decoded = atob(text);
    const [storedKey, ...rest] = decoded.split(":");

    if (storedKey !== key) throw new Error("Wrong key");

    return rest.join(":");
}

/* =========================
   AUTH TAB SWITCHING
========================= */
$("tab-login").onclick = () => {
    $("login-form").classList.remove("hidden");
    $("signup-form").classList.add("hidden");
    $("tab-login").classList.add("active");
    $("tab-signup").classList.remove("active");
};

$("tab-signup").onclick = () => {
    $("signup-form").classList.remove("hidden");
    $("login-form").classList.add("hidden");
    $("tab-signup").classList.add("active");
    $("tab-login").classList.remove("active");
};

/* =========================
   SIGNUP
========================= */
$("signup-form").onsubmit = async (e) => {
    e.preventDefault();

    const username = $("su-user").value.trim();
    const email = $("su-email").value.trim();
    const password = $("su-pass").value.trim();

    const res = await fetch("/signup", {
        method: "POST",
        headers: {
            "Content-Type":"application/json"
        },
        body: JSON.stringify({ username, email, password })
    });

    const data = await res.json();

    toast(data.message);

    if (data.success) {
        $("tab-login").click();
    }
};

/* =========================
   LOGIN
========================= */
$("login-form").onsubmit = async (e) => {
    e.preventDefault();

    const username = $("login-user").value.trim();
    const password = $("login-pass").value.trim();

    const res = await fetch("/login", {
        method:"POST",
        headers:{
            "Content-Type":"application/json"
        },
        body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!data.success) {
        toast(data.message);
        return;
    }

    currentUser = data.username;
    currentPasskey = password;

    localStorage.setItem("cipher_user", currentUser);

    $("my-name").innerText = currentUser;
    $("my-avatar").innerText = currentUser[0].toUpperCase();

    $("auth-screen").classList.add("hidden");
    $("chat-screen").classList.remove("hidden");

    socket.emit("join", currentUser);

    renderGroups();

    toast("Secure channel initialized");
};

/* =========================
   LOGOUT
========================= */
$("logout-btn").onclick = () => {
    localStorage.clear();
    location.reload();
};

/* =========================
   OPEN CHAT
========================= */
$("open-chat-btn").onclick = () => {
    const peer = $("to-input").value.trim();

    if (!peer) return;

    currentPeer = peer;

    $("peer-card").classList.remove("hidden");
    $("peer-name").innerText = peer;
    $("peer-avatar").innerText = peer[0].toUpperCase();

    $("empty-state").classList.add("hidden");
    $("messages-wrap").classList.remove("hidden");
    $("input-bar").classList.remove("hidden");

    toast(`Channel opened with ${peer}`);
};

/* =========================
   SEND MESSAGE
========================= */
$("send-btn").onclick = sendMessage;

function sendMessage() {
    const text = $("msg-input").value.trim();
    const timer = $("timer-select").value;

    if (!text || !currentPeer) return;

    const encrypted = encrypt(text, currentPasskey);
    const msgId = Date.now().toString();

    socket.emit("send-message", {
        to: currentPeer,
        message: encrypted,
        msgId,
        timer,
        isReply: !!replyTarget,
        replyToId: replyTarget?.id || null
    });

    appendMessage({
        from: currentUser,
        message: text,
        self: true,
        msgId
    });

    $("msg-input").value = "";

    clearReply();
}

/* =========================
   RECEIVE MESSAGE
========================= */
socket.on("receive-message", (data) => {
    let decrypted = "[Locked message]";

    try {
        decrypted = decrypt(data.message, currentPasskey);
    } catch {
        $("unlock-panel").classList.remove("hidden");
        $("unlock-peer-name").innerText = data.from;
    }

    appendMessage({
        from: data.from,
        message: decrypted,
        self: false,
        msgId: data.msgId
    });

    if (data.timer && Number(data.timer) > 0) {
        setTimeout(() => {
            const msg = document.querySelector(`[data-id="${data.msgId}"]`);
            if (msg) {
                $("destruct-overlay").classList.remove("hidden");

                setTimeout(() => {
                    msg.remove();
                    $("destruct-overlay").classList.add("hidden");
                }, 1500);
            }
        }, Number(data.timer) * 1000);
    }
});

/* =========================
   APPEND MESSAGE
========================= */
function appendMessage({ from, message, self, msgId }) {
    const wrap = $("messages-wrap");

    const row = document.createElement("div");
    row.className = `msg-row ${self ? "self" : ""}`;
    row.dataset.id = msgId;

    row.innerHTML = `
        <div class="msg-bubble">
            <div>${message}</div>

            <div class="msg-meta">
                <span>${from}</span>
                <span>${new Date().toLocaleTimeString()}</span>
            </div>
        </div>
    `;

    row.onclick = () => {
        replyTarget = { id: msgId, text: message };
        $("reply-preview").classList.remove("hidden");
        $("reply-text").innerText = message;
    };

    wrap.appendChild(row);
    wrap.scrollTop = wrap.scrollHeight;
}

/* =========================
   REPLY CANCEL
========================= */
$("cancel-reply").onclick = clearReply;

function clearReply() {
    replyTarget = null;
    $("reply-preview").classList.add("hidden");
}

/* =========================
   EMOJIS
========================= */
$("emoji-toggle").onclick = () => {
    $("emoji-picker").classList.toggle("hidden");
};

document.querySelectorAll("#emoji-picker span").forEach((emoji) => {
    emoji.onclick = () => {
        $("msg-input").value += emoji.innerText;
    };
});

/* =========================
   TYPING
========================= */
$("msg-input").addEventListener("input", () => {
    if (!currentPeer) return;

    socket.emit("typing", {
        to: currentPeer,
        isTyping: true
    });
});

socket.on("typing", ({ from, isTyping }) => {
    if (!isTyping) return;

    $("typing-bar").classList.remove("hidden");
    $("typing-label").innerText = `${from} is typing...`;

    clearTimeout(window.typingTimeout);

    window.typingTimeout = setTimeout(() => {
        $("typing-bar").classList.add("hidden");
    }, 2000);
});

/* =========================
   PRESENCE
========================= */
socket.on("presence", (users) => {
    const list = $("online-list");
    list.innerHTML = "";

    users.forEach((user) => {
        if (user === currentUser) return;

        const div = document.createElement("div");
        div.className = "user-chip";
        div.innerHTML = `
            <div class="user-dot"></div>
            <div>${user}</div>
        `;

        div.onclick = () => {
            $("to-input").value = user;
            $("open-chat-btn").click();
        };

        list.appendChild(div);
    });
});

/* =========================
   PASSKEY REQUEST
========================= */
$("request-key-btn").onclick = () => {
    if (!currentPeer) return;

    socket.emit("request-key", {
        to: currentPeer,
        msgId: Date.now().toString()
    });

    toast("Passkey request sent");
};

socket.on("key-request", ({ from, msgId }) => {
    incomingKeyRequest = { from, msgId };

    $("key-modal").classList.remove("hidden");
    $("key-modal-sub").innerText =
        `${from} is requesting your secure passkey`;
});

$("share-key-btn").onclick = () => {
    if (!incomingKeyRequest) return;

    socket.emit("share-passcode", {
        to: incomingKeyRequest.from,
        passcode: currentPasskey,
        msgId: incomingKeyRequest.msgId
    });

    $("key-modal").classList.add("hidden");

    toast("Passkey shared");
};

$("deny-key-btn").onclick = () => {
    $("key-modal").classList.add("hidden");
};

socket.on("passcode-share", ({ from, passcode }) => {
    currentPasskey = passcode;

    $("unlock-panel").classList.add("hidden");

    toast(`Passkey received from ${from}`);
});

/* =========================
   MANUAL UNLOCK
========================= */
$("unlock-btn").onclick = () => {
    const key = $("manual-unlock-input").value.trim();

    if (!key) return;

    currentPasskey = key;

    $("unlock-panel").classList.add("hidden");

    toast("Channel unlocked");
};

/* =========================
   GROUPS
========================= */
$("create-group-btn").onclick = () => {
    $("group-modal").classList.remove("hidden");
};

$("close-group-btn").onclick = () => {
    $("group-modal").classList.add("hidden");
};

$("save-group-btn").onclick = () => {
    const name = $("group-name").value.trim();
    const members = $("group-members").value
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);

    if (!name) return;

    groups.push({ name, members });

    localStorage.setItem("cipher_groups", JSON.stringify(groups));

    renderGroups();

    $("group-modal").classList.add("hidden");

    toast("Group created");
};

function renderGroups() {
    const list = $("groups-list");
    list.innerHTML = "";

    groups.forEach((group) => {
        const div = document.createElement("div");
        div.className = "group-chip";
        div.innerText = `👥 ${group.name}`;

        div.onclick = () => {
            toast(`Opened group: ${group.name}`);
        };

        list.appendChild(div);
    });
}

/* =========================
   PROFILE DRAWER
========================= */
$("profile-toggle").onclick = () => {
    $("profile-drawer").classList.toggle("hidden");

    $("profile-avatar-large").innerText =
        currentUser?.[0]?.toUpperCase() || "?";

    $("profile-username").innerText =
        currentUser || "Unknown";
};

/* =========================
   FORGOT PASSWORD
========================= */
$("forgot-btn").onclick = () => {
    $("forgot-modal").classList.remove("hidden");
};

$("close-forgot-btn").onclick = () => {
    $("forgot-modal").classList.add("hidden");
};

$("recover-btn").onclick = async () => {
    const user = $("forgot-username").value.trim();

    if (!user) return;

    const res = await fetch(`/check-user/${user}`);
    const data = await res.json();

    if (!data.found) {
        toast("User not found");
        return;
    }

    toast(`Recovery mail linked to ${data.maskedEmail}`);
    $("forgot-modal").classList.add("hidden");
};

/* =========================
   SEARCH
========================= */
$("search-toggle").onclick = () => {
    $("search-bar").classList.toggle("hidden");
};

$("search-input").addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();

    document.querySelectorAll(".msg-bubble").forEach((msg) => {
        msg.style.opacity =
            msg.innerText.toLowerCase().includes(term) ? "1" : ".25";
    });
});

/* =========================
   PANIC MODE
========================= */
$("panic-btn").onclick = () => {
    localStorage.clear();
    $("messages-wrap").innerHTML = "";

    toast("Panic wipe executed");

    setTimeout(() => {
        location.reload();
    }, 1200);
};