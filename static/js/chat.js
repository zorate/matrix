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
    const chatHeaderId = document.getElementById("chat-header-id");
    const btnManageAlias = document.getElementById("btn-manage-alias");
    const chatFeed = document.getElementById("chat-feed");
    const chatInputForm = document.getElementById("chat-input-form");
    const chatMessageField = document.getElementById("chat-message-field");
    const btnSendMessage = document.getElementById("btn-send-message");
    const fileImportIdentity = document.getElementById("file-import-identity");

    let socket = null;
    let myShortId = localStorage.getItem("enclave_short_id");
    let activePeerId = null;

    // --- Cryptographic Helper Subsystems ---

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

    async function generateEnclaveKeyPair() {
        return window.crypto.subtle.generateKey(
            {
                name: "RSA-OAEP",
                modulusLength: 2048,
                publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
                hash: "SHA-256"
            },
            true,
            ["encrypt", "decrypt"]
        );
    }

    async function exportPublicKey(key) {
        const exported = await window.crypto.subtle.exportKey("spki", key);
        return arrayBufferToBase64(exported);
    }

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

    async function importPrivateKey(jwk) {
        return window.crypto.subtle.importKey(
            "jwk",
            jwk,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["decrypt"]
        );
    }

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

    // --- Interface State & Contact Alias Management ---

    function loadPeerRoster() {
        peerListContainer.innerHTML = "";
        const peers = JSON.parse(localStorage.getItem("enclave_peers") || "{}");
        const aliases = JSON.parse(localStorage.getItem("matrix_contact_aliases") || "{}");
        
        Object.keys(peers).forEach(peerId => {
            const displayName = aliases[peerId] ? aliases[peerId] : `NODE: ${peerId}`;
            
            const btn = document.createElement("button");
            btn.className = "w-full text-left p-3 border border-green-900 text-xs hover:bg-green-900/30 transition flex justify-between items-center mb-1 rounded";
            
            if(peerId === activePeerId) {
                btn.classList.add("bg-green-950/60", "border-green-500");
            }
            
            btn.innerHTML = `
                <div class="flex flex-col gap-0.5">
                    <span class="font-bold text-green-400 text-xs truncate max-w-[160px]">${escapeHtml(displayName)}</span>
                    <span class="text-[9px] text-gray-500 tracking-wider">${peerId}</span>
                </div>
                <span id="unread-${peerId}" class="text-yellow-500 font-bold hidden text-[9px]">[NEW]</span>
            `;
            
            btn.onclick = () => selectPeerChat(peerId);
            peerListContainer.appendChild(btn);
        });
    }

    function selectPeerChat(peerId) {
        activePeerId = peerId;
        const aliases = JSON.parse(localStorage.getItem("matrix_contact_aliases") || "{}");
        
        // Update operational tracking frames
        chatHeaderTitle.innerText = aliases[peerId] ? aliases[peerId] : `NODE: ${peerId}`;
        chatHeaderId.innerText = `VECTOR REFERENCE: // ${peerId}`;
        
        // Unhide controls
        btnManageAlias.classList.remove("hidden");
        chatMessageField.disabled = false;
        btnSendMessage.disabled = false;
        
        document.getElementById(`unread-${peerId}`)?.classList.add("hidden");
        loadPeerRoster(); 
        renderFeedHistory(peerId);
    }

    btnManageAlias.onclick = () => {
        if (!activePeerId) return;
        const aliases = JSON.parse(localStorage.getItem("matrix_contact_aliases") || "{}");
        const currentAlias = aliases[activePeerId] || "";
        
        const newAlias = prompt(`Assign local contact name for node [ ${activePeerId} ] :`, currentAlias);
        if (newAlias === null) return; // User pressed cancel
        
        if (newAlias.trim() === "") {
            delete aliases[activePeerId];
        } else {
            aliases[activePeerId] = newAlias.trim();
        }
        
        localStorage.setItem("matrix_contact_aliases", JSON.stringify(aliases));
        chatHeaderTitle.innerText = aliases[activePeerId] ? aliases[activePeerId] : `NODE: ${activePeerId}`;
        loadPeerRoster();
    };

    function renderFeedHistory(peerId) {
        chatFeed.innerHTML = "";
        const storageKey = `msg_feed_${peerId}`;
        const feeds = JSON.parse(localStorage.getItem(storageKey) || "[]");
        
        if(feeds.length === 0) {
            chatFeed.innerHTML = `<div class="text-center text-gray-700 my-auto text-xs">Channel structural pipeline open. Send a packet.</div>`;
            return;
        }

        feeds.forEach(msg => {
            const wrapper = document.createElement("div");
            wrapper.className = `flex flex-col max-w-[80%] ${msg.sender === 'ME' ? 'self-end items-end' : 'self-start items-start'}`;
            
            const timestamp = new Date(msg.time * 1000).toLocaleTimeString();
            wrapper.innerHTML = `
                <div class="text-[9px] text-gray-500 tracking-wide">${msg.sender === 'ME' ? 'LOCAL TRANSMIT' : 'DECRYPTED PEER'} [${timestamp}]</div>
                <div class="p-2 brutalist-border bg-black text-green-400 mt-1 rounded text-xs whitespace-pre-wrap">${escapeHtml(msg.text)}</div>
            `;
            chatFeed.appendChild(wrapper);
        });
        chatFeed.scrollTop = chatFeed.scrollHeight;
    }

    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // --- Identity Backup Portability Infrastructure ---

    window.exportIdentityToBackupFile = async function() {
        const myShortId = localStorage.getItem("enclave_short_id");
        const myPrivateJwk = localStorage.getItem("enclave_private_jwk");
        const peerRoster = localStorage.getItem("enclave_peers");
        const contactAliases = localStorage.getItem("matrix_contact_aliases");

        if(!myShortId || !myPrivateJwk) {
            alert("No configuration metadata detected to process backup loops.");
            return;
        }

        const backupPayload = {
            short_id: myShortId,
            private_jwk: JSON.parse(myPrivateJwk),
            peers: JSON.parse(peerRoster || "{}"),
            aliases: JSON.parse(contactAliases || "{}")
        };

        const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `matrix_identity_backup_${myShortId}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    fileImportIdentity.onchange = function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(evt) {
            try {
                const importedData = JSON.parse(evt.target.result);
                if (!importedData.short_id || !importedData.private_jwk) {
                    alert("Fatal: Cryptographic key vectors are missing from backup structural syntax.");
                    return;
                }

                // Commit everything into local phone storage maps directly
                localStorage.setItem("enclave_short_id", importedData.short_id);
                localStorage.setItem("enclave_private_jwk", JSON.stringify(importedData.private_jwk));
                localStorage.setItem("enclave_peers", JSON.stringify(importedData.peers || {}));
                localStorage.setItem("matrix_contact_aliases", JSON.stringify(importedData.aliases || {}));

                alert("Cryptographic matrix context imported perfectly! Activating application node...");
                window.location.reload();
            } catch(err) {
                alert("Error reading key package mapping layers: " + err);
            }
        };
        reader.readAsText(file);
    };

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
            peerLookupStatus.innerText = "Error: Use XXX-XXX layout.";
            return;
        }
        peerLookupStatus.innerText = "Querying cluster indexes...";
        
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
            peerLookupStatus.innerText = "Network pipeline timeout.";
        }
    };

    function initializeWebsocketSession() {
        socket = io();

        socket.on('connect', () => {
            console.log("Enclave network link established.");
            socket.emit('authenticate', { short_key: myShortId });
        });

        socket.on('disconnect', () => {
            console.warn("Transport connection terminated.");
        });

        socket.on('receive_message', async (packet) => {
            const sender = packet.sender_id;
            const encryptedPayload = packet.payload;
            
            const peers = JSON.parse(localStorage.getItem("enclave_peers") || "{}");
            if (!peers[sender]) {
                try {
                    const res = await fetch(`/api/identity/lookup/${sender}`);
                    if (res.ok) {
                        const data = await res.json();
                        peers[sender] = data.public_key;
                        localStorage.setItem("enclave_peers", JSON.stringify(peers));
                    } else { return; } 
                } catch(e) { return; }
            }

            const myPrivateJwk = JSON.parse(localStorage.getItem("enclave_private_jwk"));
            const privateKeyObj = await importPrivateKey(myPrivateJwk);
            const decryptedString = await decryptPayload(encryptedPayload, privateKeyObj);

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

        if (!socket || !socket.connected) {
            alert("Transmission pipeline offline. Unable to complete packet exchange.");
            return;
        }

        chatMessageField.value = "";
        
        const peers = JSON.parse(localStorage.getItem("enclave_peers") || "{}");
        const targetPublicKeyPEM = peers[activePeerId];
        
        try {
            const targetPubKeyObj = await importPublicKey(targetPublicKeyPEM);
            const cipherText = await encryptPayload(txt, targetPubKeyObj);
            const timestamp = Math.floor(Date.now() / 1000);
            
            socket.emit('send_msg', {
                recipient_id: activePeerId,
                encrypted_payload: cipherText
            });

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
            alert("Cryptographic processing failure: " + err);
        }
    };

    bootstrapNode();
});