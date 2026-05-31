let socket = null;
let myShortId = localStorage.getItem("enclave_short_id");
let activePeerId = null;

// DOM cache
let activationScreen, coreApplication, btnGenerate, genStatus;
let myIdDisplay, peerListContainer, chatHeaderTitle, chatHeaderId;
let chatFeed, chatInputForm, chatMessageField, btnSendMessage;
let fileImportIdentity, btnRecordAudio;

// state
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// ---------------- INIT ----------------
document.addEventListener("DOMContentLoaded", init);

function init() {
    cacheDOM();
    bootstrapNode();
    bindUI();
}

// ---------------- DOM CACHE ----------------
function cacheDOM() {
    activationScreen = document.getElementById("activation-screen");
    coreApplication = document.getElementById("core-application");
    btnGenerate = document.getElementById("btn-generate");
    genStatus = document.getElementById("generation-status");

    myIdDisplay = document.getElementById("display-my-id");
    peerListContainer = document.getElementById("peer-list");

    chatHeaderTitle = document.getElementById("chat-header-title");
    chatHeaderId = document.getElementById("chat-header-id");

    chatFeed = document.getElementById("chat-feed");
    chatInputForm = document.getElementById("chat-input-form");
    chatMessageField = document.getElementById("chat-message-field");
    btnSendMessage = document.getElementById("btn-send-message");

    fileImportIdentity = document.getElementById("file-import-identity");
    btnRecordAudio = document.getElementById("btn-record-audio");
}

// ---------------- BOOTSTRAP ----------------
function bootstrapNode() {
    myShortId = localStorage.getItem("enclave_short_id");

    if (!myShortId) {
        showActivation();
        return;
    }

    showApp();
    loadPeerRoster();
    initSocket();
}

function showActivation() {
    activationScreen?.classList.remove("hidden");
    coreApplication?.classList.add("hidden");
}

function showApp() {
    activationScreen?.classList.add("hidden");
    coreApplication?.classList.remove("hidden");

    if (myIdDisplay) myIdDisplay.innerText = myShortId;
}

// ---------------- SOCKET ----------------
function initSocket() {
    if (socket) return;

    socket = io();

    socket.on("connect", () => {
        socket.emit("authenticate", { short_key: myShortId });
    });

    socket.on("receive_message", async (packet) => {
        await handleIncoming(packet);
    });

    socket.on("disconnect", () => {
        console.warn("Socket disconnected");
    });
}

// ---------------- MESSAGE HANDLER ----------------
async function handleIncoming(packet) {
    const sender = packet.sender_id;
    const raw = packet.payload;

    let type = "text";
    let output = "";

    try {
        if (raw.startsWith("STRUCT_MEDIA_PACKET:")) {
            const [, mediaType, ...rest] = raw.split(":");
            type = mediaType;

            const json = rest.join(":");
            const buffer = await decryptHybrid(json);

            if (buffer) {
                const blob = new Blob([buffer], { type: "audio/webm" });
                output = URL.createObjectURL(blob);
            }
        } else {
            const buffer = await decryptHybrid(raw);
            output = buffer ? new TextDecoder().decode(buffer) : "[DECRYPT FAIL]";
        }
    } catch (e) {
        output = "[STREAM ERROR]";
    }

    saveMessage(sender, {
        sender,
        type,
        text: output,
        time: packet.timestamp || Date.now() / 1000
    });

    if (activePeerId === sender) {
        renderFeed(sender);
    } else {
        loadPeerRoster();
    }
}

// ---------------- UI ----------------
function loadPeerRoster() {
    if (!peerListContainer) return;

    peerListContainer.innerHTML = "";
    const peers = JSON.parse(localStorage.getItem("enclave_peers") || "{}");

    Object.keys(peers).forEach(id => {
        const btn = document.createElement("button");
        btn.className = "w-full p-2 border border-green-900 text-xs";
        btn.textContent = id;

        btn.onclick = () => selectPeer(id);
        peerListContainer.appendChild(btn);
    });
}

function selectPeer(id) {
    activePeerId = id;

    chatHeaderTitle.textContent = id;
    chatMessageField.disabled = false;
    btnSendMessage.disabled = false;
    btnRecordAudio.disabled = false;

    renderFeed(id);
}

// ---------------- CHAT RENDER ----------------
function renderFeed(peerId) {
    const msgs = JSON.parse(localStorage.getItem(`msg_feed_${peerId}`) || "[]");

    chatFeed.innerHTML = "";

    msgs.forEach(m => {
        const div = document.createElement("div");
        div.className = "text-xs p-2";

        if (m.type === "voice") {
            div.innerHTML = `<audio controls src="${m.text}"></audio>`;
        } else {
            div.textContent = m.text;
        }

        chatFeed.appendChild(div);
    });
}

// ---------------- STORAGE ----------------
function saveMessage(peerId, msg) {
    const key = `msg_feed_${peerId}`;
    const data = JSON.parse(localStorage.getItem(key) || "[]");
    data.push(msg);
    localStorage.setItem(key, JSON.stringify(data));
}

// ---------------- CRYPTO (SAFE WRAPPER) ----------------
async function decryptHybrid(json, privateKeyObj) {
    try {
        const obj = JSON.parse(json);

        const keyBuf = base64ToArrayBuffer(obj.enc_key);
        const iv = new Uint8Array(base64ToArrayBuffer(obj.iv));
        const data = base64ToArrayBuffer(obj.ciphertext);

        const rawKey = await crypto.subtle.decrypt(
            { name: "RSA-OAEP" },
            privateKeyObj,
            keyBuf
        );

        const aes = await crypto.subtle.importKey(
            "raw",
            rawKey,
            "AES-GCM",
            false,
            ["decrypt"]
        );

        return await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            aes,
            data
        );
    } catch (e) {
        return null;
    }
}

// ---------------- BASE64 ----------------
function base64ToArrayBuffer(base64) {
    const bin = atob(base64);
    const len = bin.length;
    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
        bytes[i] = bin.charCodeAt(i);
    }
    return bytes.buffer;
}

// ---------------- UI BIND ----------------
function bindUI() {
    btnGenerate?.addEventListener("click", async () => {
        genStatus.innerText = "Generating identity...";
        // keep your existing backend logic unchanged
    });

    chatInputForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
    });
}
