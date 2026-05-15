document.addEventListener("DOMContentLoaded", () => {
    // UI Layout Pointers
    const activationScreen = document.getElementById("activation-screen");
    const coreApplication = document.getElementById("core-application");
    const btnGenerate = document.getElementById("btn-generate");
    const genStatus = document.getElementById("generation-status");
    const myIdDisplay = document.getElementById("display-my-id");
    const inputPeerId = document.getElementById("input-peer-id");
    const btnAddPeer = document.getElementById("btn-add-peer");
    const peerLookupStatus = document.getElementById("peer-lookup-status");
    const peerListContainer = document.getElementById("peer-list");
    const chatHeaderTitle = document.getElementById("chat-header-title");
    const chatFeed = document.getElementById("chat-feed");
    const chatInputForm = document.getElementById("chat-input-form");
    const chatMessageField = document.getElementById("chat-message-field");
    const btnSendMessage = document.getElementById("btn-send-message");

    let socket = null;
    let myShortId = localStorage.getItem("enclave_short_id");
    let activePeerId = null;

    // --- Cryptographic Helper Subsystems ---

    // ArrayBuffer to string conversion pipelines for serialization
    function arrayBufferToBase64(buffer) {
        let binary = '';
        let bytes = new Uint8Array(buffer);
        let len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    function base64ToArrayBuffer(base64) {
        let binary_string = window.atob(base64);
        let len = binary_string.length;
        let bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // Generate local RSA keypairs for asymmetric E2E encryption
    async function generateEnclaveKeyPair() {
        return window.crypto.subtle.generateKey(
            {
                name: "RSA-OAEP",
                modulusLength: 2048,
                publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
                hash: "SHA-256"
            },
            true, // extractable
            ["encrypt", "decrypt"]
        );
    }

    // Export public crypto keys out into shareable formats
    async function exportPublicKey(key) {
        const exported = await window.crypto.subtle.exportKey("spki", key);
        return arrayBufferToBase64(exported);
    }

    // Import external peer verification keys for encryption pipelines
    async function importPublicKey(pemBase64) {
        const buffer = base64ToArrayBuffer(pemBase64);
        return window.crypto.subtle.importKey(
            "spki",
            buffer,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["encrypt"]
        );
    }

    // Import your private key stored inside local configuration matrixes
    async function importPrivateKey(jwk) {
        return window.crypto.subtle.importKey(
            "jwk",
            jwk,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["decrypt"]
        );
    }

    // Core encryption: plaintext -> cipher array
    async function encryptPayload(plaintext, publicKeyObj) {
        const encoder = new TextEncoder();
        const data = encoder.encode(plaintext);
        const encrypted = await window.crypto.subtle.encrypt(
            { name: "RSA-OAEP" },
            publicKeyObj,
            data
        );
        return arrayBufferToBase64(encrypted);
    }

    // Core decryption: cipher array -> plaintext
    async function decryptPayload(cipherBase64, privateKeyObj) {
        const data = base64ToArrayBuffer(cipherBase64);
        try {
            const decrypted = await window.crypto.subtle.decrypt(
                { name: "RSA-OAEP" },
                privateKeyObj,
                data
            );
            const decoder = new TextDecoder();
            return decoder.decode(decrypted);
        } catch (e) {
            return "[ SYSTEM ERROR: FAILED DECRYPTION DEVIATION - STRUCTURAL COMPROMISE ]";
        }
    }

    // --- Interface State Management ---

    function loadPeerRoster() {
        peerListContainer.innerHTML = "";
        const peers = JSON.parse(localStorage.getItem("enclave_peers") || "{}");
        Object.keys(peers).forEach(peerId => {
            const btn = document.createElement("button");
            btn.className = "w-full text-left p-2 border border-green-900 text-xs hover:bg-green-900 transition flex justify-between";
            btn.innerHTML = `<span>NODE: ${peerId}</span><span id="unread-${peerId}" class="text-yellow-500 hidden">[NEW]</span>`;
            if(peerId === activePeerId) {
                btn.classList.add("active-chat");
            }
            btn.onclick = () => selectPeerChat(peerId);
            peerListContainer.appendChild(btn);
        });
    }

    function selectPeerChat(peerId) {
        activePeerId = peerId;
        chatHeaderTitle.innerText = `NODE: ${peerId}`;
        chatMessageField.disabled = false;
        btnSendMessage.disabled = false;
        
        document.getElementById(`unread-${peerId}`)?.classList.add("hidden");
        loadPeerRoster(); // Refresh highlight states
        renderFeedHistory(peerId);
    }

    function renderFeedHistory(peerId) {
        chatFeed.innerHTML = "";
        const storageKey = `msg_feed_${peerId}`;
        const feeds = JSON.parse(localStorage.getItem(storageKey) || "[]");
        
        if(feeds.length === 0) {
            chatFeed.innerHTML = `<div class="text-center text-gray-700 my-auto">Channel structural pipeline open. Send a packet.</div>`;
            return;
        }

        feeds.forEach(msg => {
            const wrapper = document.createElement("div");
            wrapper.className = `flex flex-col max-w-[80%] ${msg.sender === 'ME' ? 'self-end items-end' : 'self-start items-start'}`;
            
            const timestamp = new Date(msg.time * 1000).toLocaleTimeString();
            wrapper.innerHTML = `
                <div class="text-[10px] text-gray-500">${msg.sender === 'ME' ? 'LOCAL' : 'PEER'} [${timestamp}]</div>
                <div class="p-2 brutalist-border bg-black text-green-400 mt-1 rounded whitespace-pre-wrap">${escapeHtml(msg.text)}</div>
            `;
            chatFeed.appendChild(wrapper);
        });
        chatFeed.scrollTop = chatFeed.scrollHeight;
    }

    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // --- Initialization and Orchestration Pipelines ---

    async function bootstrapNode() {
        if (!myShortId) {
            activationScreen.classList.remove("hidden");
            activationScreen.classList.add("flex");
            return;
        }

        activationScreen.classList.add("hidden");
        coreApplication.classList.remove("hidden");
        coreApplication.classList.add("flex");
        myIdDisplay.innerText = myShortId;
        
        loadPeerRoster();
        initializeWebsocketSession();
    }

    btnGenerate.onclick = async () => {
        btnGenerate.disabled = true;
        genStatus.innerText = "COMPUTING CRYPTOGRAPHIC ENCLAVE IDENTITY PAIR...";
        
        try {
            const keyPair = await generateEnclaveKeyPair();
            const exportedPublic = await exportPublicKey(keyPair.publicKey);
            const exportedPrivateJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
            
            // Post public pointer configuration structure to target server allocations
            const response = await fetch('/api/identity/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ public_key: exportedPublic })
            });

            const responseData = await response.json();
            if (response.ok) {
                localStorage.setItem("enclave_short_id", responseData.short_key);
                localStorage.setItem("enclave_private_jwk", JSON.stringify(exportedPrivateJwk));
                localStorage.setItem("enclave_peers", JSON.stringify({}));
                myShortId = responseData.short_key;
                bootstrapNode();
            } else {
                genStatus.innerText = `ERR: ${responseData.error}`;
                btnGenerate.disabled = false;
            }
        } catch (err) {
            genStatus.innerText = `FATAL RUNTIME CONFIGURATION FAIL: ${err}`;
            btnGenerate.disabled = false;
        }
    };

    btnAddPeer.onclick = async () => {
        const lookupVal = inputPeerId.value.toUpperCase().trim();
        if(!lookupVal || lookupVal.length !== 7) {
            peerLookupStatus.innerText = "Error: Input must evaluate to exact XXX-XXX formatting rules.";
            return;
        }
        peerLookupStatus.innerText = "Querying distributed routing indexes...";
        
        try {
            const res = await fetch(`/api/identity/lookup/${lookupVal}`);
            const data = await res.json();
            
            if(res.ok) {
                const peers = JSON.parse(localStorage.getItem("enclave_peers") || "{}");
                peers[lookupVal] = data.public_key;
                localStorage.setItem("enclave_peers", JSON.stringify(peers));
                peerLookupStatus.innerText = "Handshake resolved. Node appended.";
                inputPeerId.value = "";
                loadPeerRoster();
            } else {
                peerLookupStatus.innerText = `Failed: ${data.error}`;
            }
        } catch(e) {
            peerLookupStatus.innerText = "Network pipeline translation drop.";
        }
    };

    function initializeWebsocketSession() {
        // FIXED: Removed invalid "{ transparent: true }" configuration which breaks the pipeline initialization.
        socket = io();

        socket.on('connect', () => {
            console.log("Enclave network link established.");
            // Immediately authenticate routing parameters
            socket.emit('authenticate', { short_key: myShortId });
        });

        socket.on('disconnect', () => {
            console.warn("Enclave network link dropped. Retrying transport connection...");
        });

        socket.on('receive_message', async (packet) => {
            const sender = packet.sender_id;
            const encryptedPayload = packet.payload;
            
            // Look up verification keys inside local stores
            const peers = JSON.parse(localStorage.getItem("enclave_peers") || "{}");
            if (!peers[sender]) {
                // Out-of-band message from unrecognized node. Force automated resolution on-the-fly
                try {
                    const res = await fetch(`/api/identity/lookup/${sender}`);
                    if (res.ok) {
                        const data = await res.json();
                        peers[sender] = data.public_key;
                        localStorage.setItem("enclave_peers", JSON.stringify(peers));
                    } else { return; } // Drop unverified packet structures
                } catch(e) { return; }
            }

            const myPrivateJwk = JSON.parse(localStorage.getItem("enclave_private_jwk"));
            const privateKeyObj = await importPrivateKey(myPrivateJwk);
            const decryptedString = await decryptPayload(encryptedPayload, privateKeyObj);

            // Commit transaction to localized structural state storage records
            const storageKey = `msg_feed_${sender}`;
            const history = JSON.parse(localStorage.getItem(storageKey) || "[]");
            history.push({
                sender: sender,
                text: decryptedString,
                time: packet.timestamp || Math.floor(Date.now() / 1000)
            });
            localStorage.setItem(storageKey, JSON.stringify(history));

            if(activePeerId === sender) {
                renderFeedHistory(sender);
            } else {
                loadPeerRoster();
                document.getElementById(`unread-${sender}`)?.classList.remove("hidden");
            }
        });
    }

    chatInputForm.onsubmit = async (e) => {
        e.preventDefault();
        const txt = chatMessageField.value.trim();
        if(!txt || !activePeerId) return;

        // CRITICAL CHECK: Block transmissions if socket connection has dropped
        if (!socket || !socket.connected) {
            alert("Transmission pipeline offline. Re-establishing connection with server network...");
            return;
        }

        chatMessageField.value = "";
        
        const peers = JSON.parse(localStorage.getItem("enclave_peers") || "{}");
        const targetPublicKeyPEM = peers[activePeerId];
        
        try {
            const targetPubKeyObj = await importPublicKey(targetPublicKeyPEM);
            const cipherText = await encryptPayload(txt, targetPubKeyObj);
            
            const timestamp = Math.floor(Date.now() / 1000);
            
            // Transmit direct array states down sockets safely
            socket.emit('send_msg', {
                recipient_id: activePeerId,
                encrypted_payload: cipherText
            });

            // Commit output vectors internally locally
            const storageKey = `msg_feed_${activePeerId}`;
            const history = JSON.parse(localStorage.getItem(storageKey) || "[]");
            history.push({
                sender: 'ME',
                text: txt,
                time: timestamp
            });
            localStorage.setItem(storageKey, JSON.stringify(history));
            renderFeedHistory(activePeerId);

        } catch(err) {
            alert("Cryptographic transmission failure matching parameters: " + err);
        }
    };

    // Instantiate Startup Sequences
    bootstrapNode();
});