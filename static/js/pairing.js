document.addEventListener("DOMContentLoaded", () => {
    const inputPeerId = document.getElementById("input-peer-id");
    const btnAddPeer = document.getElementById("btn-add-peer");
    const peerLookupStatus = document.getElementById("peer-lookup-status");

    if (btnAddPeer) {
        btnAddPeer.onclick = async () => {
            const lookupVal = inputPeerId.value.toUpperCase().trim();
            if(!lookupVal || lookupVal.length !== 6) {
                if (peerLookupStatus) peerLookupStatus.innerText = "Error: Input must be exactly 6 characters.";
                return;
            }
            if (peerLookupStatus) peerLookupStatus.innerText = "Querying cluster indexes...";
            
            try {
                const res = await fetch(`/api/identity/lookup/${lookupVal}`);
                const data = await res.json();
                
                if(res.ok) {
                    const peers = JSON.parse(localStorage.getItem("enclave_peers") || "{}");
                    peers[lookupVal] = data.public_key;
                    localStorage.setItem("enclave_peers", JSON.stringify(peers));
                    
                    if (peerLookupStatus) peerLookupStatus.innerText = "Handshake resolved. Node appended.";
                    inputPeerId.value = "";
                    
                    setTimeout(() => {
                        window.location.href = "/";
                    }, 1000);
                } else {
                    if (peerLookupStatus) peerLookupStatus.innerText = `Failed: ${data.error}`;
                }
            } catch(e) {
                if (peerLookupStatus) peerLookupStatus.innerText = "Network pipeline timeout.";
            }
        };
    }
});
