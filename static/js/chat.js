document.addEventListener("DOMContentLoaded", () => {
    // UI Layout Pointers
    const activationScreen = document.getElementById("activation-screen");
    const coreApplication = document.getElementById("core-application");
    const btnGenerate = document.getElementById("btn-generate");
    const genStatus = document.getElementById("generation-status");
    const myIdDisplay = document.getElementById("display-my-id");
    const peerListContainer = document.getElementById("peer-list");
    const chatHeaderTitle = document.getElementById("chat-header-title");
    const chatHeaderId = document.getElementById("chat-header-id");
    const btnManageAlias = document.getElementById("btn-manage-alias");
    const chatFeed = document.getElementById("chat-feed");
    const chatInputForm = document.getElementById("chat-input-form");
    const chatMessageField = document.getElementById("chat-message-field");
    const btnSendMessage = document.getElementById("btn-send-message");
    const fileImportIdentity = document.getElementById("file-import-identity");
    const btnRecordAudio = document.getElementById("btn-record-audio");

    let socket = null;
    let myShortId = localStorage.getItem("enclave_short_id");
    let activePeerId = null;

    // Audio Recorder States
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;

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

    // --- HYBRID ENCRYPTION ENGINE FOR ANY DATA SIZE ---

    async function encryptHybridPayload(rawArrayBuffer, peerPublicKeyObj) {
        const aesKey = await window.crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt"]
        );

        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encryptedDataBuffer = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            aesKey,
            rawArrayBuffer
        );

        const exportedAesRaw = await window.crypto.subtle.exportKey("raw", aesKey);

        const encryptedAesKeyBuffer = await window.crypto.subtle.encrypt(
            { name: "RSA-OAEP" },
            peerPublicKeyObj,
            exportedAesRaw
        );

        return JSON.stringify({
            enc_key: arrayBufferToBase64(encryptedAesKeyBuffer),
            iv: arrayBufferToBase64(iv),
            ciphertext: arrayBufferToBase64(encryptedDataBuffer)
        });
    }

    async function decryptHybridPayload(serializedHybridJson, myPrivateKeyObj) {
        try {
            const packageObj = JSON.parse(serializedHybridJson);
            
            const encryptedAesKeyBuffer = base64ToArrayBuffer(packageObj.enc_key);
            const iv = new Uint8Array(base64ToArrayBuffer(packageObj.iv));
            const ciphertextBuffer = base64ToArrayBuffer(packageObj.ciphertext);

            const rawAesKeyBuffer = await window.crypto.subtle.decrypt(
                { name: "RSA-OAEP" },
                myPrivateKeyObj,
                encryptedAesKeyBuffer
            );

            const aesKey = await window.crypto.subtle.importKey(
                "raw",
                rawAesKeyBuffer,
                { name: "AES-GCM" },
                false,
                ["decrypt"]
            );

            return await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                aesKey,
                ciphertextBuffer
            );
        } catch (e) {
            console.error("Hybrid core tracking decryption fault:", e);
            return null;
        }
    }

    // --- Interface State Management ---

    function loadPeerRoster() {
        if (!peerListContainer) return;
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

        localStorage.setItem("matrix_active_peer_context", peerId);
        
        const aliases = JSON.parse(localStorage.getItem("matrix_contact_aliases") || "{}");
        
        if (chatHeaderTitle) chatHeaderTitle.innerText = aliases[peerId] ? aliases[peerId] : `NODE: ${peerId}`;
        if (chatHeaderId) chatHeaderId.innerText = `VECTOR REFERENCE: // ${peerId}`;
        
        if (btnManageAlias) btnManageAlias.classList.remove("hidden");
        if (chatMessageField) chatMessageField.disabled = false;
        if (btnSendMessage) btnSendMessage.disabled = false;
        if (btnRecordAudio) btnRecordAudio.disabled = false;
        
        document.getElementById(`unread-${peerId}`)?.classList.add("hidden");
        loadPeerRoster(); 
        renderFeedHistory(peerId);
    }

    function renderFeedHistory(peerId) {
        if (!chatFeed) return;
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
            
            let payloadHtml = "";
            
            if (msg.type === "voice") {
                payloadHtml = `
                    <div class="p-2 brutalist-border bg-zinc-950 mt-1 rounded flex items-center gap-2">
                        <span class="text-xs">🎵 [VOICE]</span>
                        <audio src="${msg.text}" controls class="h-8 max-w-[210px] filter invert sepia hue-rotate-60 brightness-75"></audio>
                    </div>`;
            } else {
                payloadHtml = `<div class="p-2 brutalist-border bg-black text-green-400 mt-1 rounded text-xs whitespace-pre-wrap">${escapeHtml(msg.text)}</div>`;
            }
            
            wrapper.innerHTML = `
                <div class="text-[9px] text-gray-500 tracking-wide">${msg.sender === 'ME' ? 'LOCAL TRANSMIT' : 'DECRYPTED PEER'} [${timestamp}]</div>
                ${payloadHtml}
            `;
            chatFeed.appendChild(wrapper);
        });
        chatFeed.scrollTop = chatFeed.scrollHeight;
    }

    function escapeHtml(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // --- Audio Voice Recording Engine ---

    async function startRecordingVoice() {
        if (!activePeerId || isRecording) return;
        audioChunks = [];
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(track => track.stop());
                if (audioChunks.length === 0) return;
                
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const arrayBuffer = await audioBlob.arrayBuffer();
                
                await sendSecureMediaPacket(arrayBuffer, "voice");
            };

            mediaRecorder.start();
            isRecording = true;
            if (btnRecordAudio) {
                btnRecordAudio.innerText = "🛑";
                btnRecordAudio.classList.remove("text-green-500");
                btnRecordAudio.classList.add("text-red-500", "animate-pulse");
            }
            if (chatMessageField) {
                chatMessageField.placeholder = "!!! RECORDING RAW SECURE AUDIO PAYLOAD DIRECTLY FROM CAPTURE LAYER !!!";
                chatMessageField.classList.add("border-red-900", "text-red-500");
            }
        } catch (err) {
            alert("Microphone capture permission request rejected: " + err);
            resetRecordButtonUI();
        }
    }

    function stopRecordingVoice() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
        }
        resetRecordButtonUI();
    }

    function resetRecordButtonUI() {
        isRecording = false;
        if (btnRecordAudio) {
            btnRecordAudio.innerText = "🎙️";
            btnRecordAudio.classList.remove("text-red-500", "animate-pulse");
            btnRecordAudio.classList.add("text-green-500");
        }
        if (chatMessageField) {
            chatMessageField.placeholder = "Input payload text packets to transit...";
            chatMessageField.classList.remove("border-red-900", "text-red-500");
        }
    }

    if (btnRecordAudio) {
        btnRecordAudio.addEventListener("mousedown", (e) => { 
            e.preventDefault(); 
            startRecordingVoice(); 
        });
        
        btnRecordAudio.addEventListener("touchstart", (e) => { 
            e.preventDefault(); 
            startRecordingVoice(); 
        }, { passive: false });

        btnRecordAudio.addEventListener("click", (e) => {
            e.preventDefault();
            if (!activePeerId) return;
            if (isRecording) stopRecordingVoice();
        });
    }
    
    window.addEventListener("mouseup", (e) => { 
        if (isRecording) stopRecordingVoice(); 
    });
    
    window.addEventListener("touchend", (e) => { 
        if (isRecording) stopRecordingVoice(); 
    });

    // --- Unified Media Packet Transmitter ---

    async function sendSecureMediaPacket(rawArrayBuffer, typeFlag) {
        if (!socket || !socket.connected || !activePeerId) return;

        const peers = JSON.parse(localStorage.getItem("enclave_peers") || "{}");
        const targetPublicKeyPEM = peers[activePeerId];

        if (!targetPublicKeyPEM) {
            alert("No public key verified for target peer node.");
            return;
        }

        try {
            const targetPubKeyObj = await importPublicKey(targetPublicKeyPEM);
            const hybridCiphertextJson = await encryptHybridPayload(rawArrayBuffer, targetPubKeyObj);
            const timestamp = Math.floor(Date.now() / 1000);
            const metaEncryptedMessage = "STRUCT_MEDIA_PACKET:" + typeFlag + ":" + hybridCiphertextJson;

            socket.emit('send_msg', {
                recipient_id: activePeerId,
                encrypted_payload: metaEncryptedMessage
            });

            const localBlob = new Blob([rawArrayBuffer], { type: 'audio/webm' });
            const localBlobUrl = URL.createObjectURL(localBlob);

            const storageKey = `msg_feed_${activePeerId}`;
            const history = JSON.parse(localStorage.getItem(storageKey) || "[]");
            history.push({
                sender: 'ME',
                type: typeFlag,
                text: localBlobUrl,
                time: timestamp
            });
            localStorage.setItem(storageKey, JSON.stringify(history));
            renderFeedHistory(activePeerId);

        } catch (err) {
            alert("Media packaging failure: " + err);
        }
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

    if (fileImportIdentity) {
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
    }




    document.addEventListener("DOMContentLoaded", () => {
        const id = localStorage.getItem("enclave_short_id");

        if (!id) {
            document.getElementById("core-application")?.classList.add("hidden");
            document.getElementById("activation-screen")?.classList.remove("hidden");
        }
    });
    
    // --- Initialization and Orchestration Pipelines ---

    async function bootstrapNode() {
        myShortId = localStorage.getItem("enclave_short_id");

        // CASE 1: NO ID → activation mode
        if (!myShortId) {
            activationScreen?.classList.remove("hidden");
            coreApplication?.classList.add("hidden");

            if (genStatus) genStatus.innerText = "Identity required to initialize node.";

            return;
        }

        // CASE 2: HAS ID → app mode
        activationScreen?.classList.add("hidden");
        coreApplication?.classList.remove("hidden");

        if (myIdDisplay) myIdDisplay.innerText = myShortId;

        loadPeerRoster();
        initializeWebsocketSession();
    }

    if (btnGenerate) {
        btnGenerate.onclick = async () => {
            btnGenerate.disabled = true;
            if (genStatus) genStatus.innerText = "COMPUTING CRYPTOGRAPHIC ENCLAVE IDENTITY PAIR...";
            
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
                    if (genStatus) genStatus.innerText = `ERR: ${responseData.error}`;
                    btnGenerate.disabled = false;
                }
            } catch (err) {
                if (genStatus) genStatus.innerText = `FATAL RUNTIME CONFIGURATION FAIL: ${err}`;
                btnGenerate.disabled = false;
            }
        };
    }

    function initializeWebsocketSession() {
        socket = io();

        socket.on('connect', () => {
            console.log("Enclave network link established.");
            socket.emit('authenticate', { short_key: myShortId });
        });

        socket.on('receive_message', async (packet) => {
            const sender = packet.sender_id;
            let rawEncryptedPayload = packet.payload;
            let messageType = "text";
            
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
            
            let finalOutputStringOrUrl = "";

            try {
                if (rawEncryptedPayload.startsWith("STRUCT_MEDIA_PACKET:")) {
                    const structuralParts = rawEncryptedPayload.split(":");
                    messageType = structuralParts[1];
                    const actualHybridJson = structuralParts.slice(2).join(":");

                    const decryptedBinaryBuffer = await decryptHybridPayload(actualHybridJson, privateKeyObj);
                    
                    if (decryptedBinaryBuffer) {
                        const decryptedBlob = new Blob([decryptedBinaryBuffer], { type: 'audio/webm' });
                        finalOutputStringOrUrl = URL.createObjectURL(decryptedBlob);
                    } else {
                        finalOutputStringOrUrl = "[ SYSTEM ERROR: DATA LAYER DECRYPTION VIOLATION ]";
                        messageType = "text";
                    }
                } else {
                    messageType = "text";
                    const decryptedTextBuffer = await decryptHybridPayload(rawEncryptedPayload, privateKeyObj);
                    
                    if (decryptedTextBuffer) {
                        finalOutputStringOrUrl = new TextDecoder().decode(decryptedTextBuffer);
                    } else {
                        try {
                            const dataBytes = base64ToArrayBuffer(rawEncryptedPayload);
                            const decryptedBytes = await window.crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKeyObj, dataBytes);
                            finalOutputStringOrUrl = new TextDecoder().decode(decryptedBytes);
                        } catch(legacyErr) {
                            finalOutputStringOrUrl = "[ SYSTEM ERROR: FAILED DECRYPTION DEVIATION ]";
                        }
                    }
                }
            } catch (globalPacketErr) {
                console.error("Critical stream parser crash: ", globalPacketErr);
                finalOutputStringOrUrl = "[ SYSTEM ERROR: STREAM PARSER EXCEPTION ]";
                messageType = "text";
            }

            const storageKey = `msg_feed_${sender}`;
            const history = JSON.parse(localStorage.getItem(storageKey) || "[]");
            history.push({
                sender: sender,
                type: messageType,
                text: finalOutputStringOrUrl,
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

    if (chatInputForm) {
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
                const dataBuffer = new TextEncoder().encode(txt);
                
                const hybridCiphertextJson = await encryptHybridPayload(dataBuffer.buffer, targetPubKeyObj);
                const timestamp = Math.floor(Date.now() / 1000);
                
                socket.emit('send_msg', {
                    recipient_id: activePeerId,
                    encrypted_payload: hybridCiphertextJson
                });

                const storageKey = `msg_feed_${activePeerId}`;
                const history = JSON.parse(localStorage.getItem(storageKey) || "[]");
                history.push({
                    sender: 'ME',
                    type: "text",
                    text: txt,
                    time: timestamp
                });
                localStorage.setItem(storageKey, JSON.stringify(history));
                renderFeedHistory(activePeerId);

            } catch(err) {
                alert("Cryptographic processing failure: " + err);
            }
        };
    }

    bootstrapNode();
});
