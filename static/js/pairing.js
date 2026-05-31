document.addEventListener("DOMContentLoaded", () => {

    const inputPeerId = document.getElementById("peerKeyInput");
    const btnAddPeer = document.getElementById("executePairingBtn");
    const peerLookupStatus = document.getElementById("pairingStatusFeedback");

    btnAddPeer?.addEventListener("click", async () => {

        const lookupVal = inputPeerId.value.toUpperCase().trim();

        if (!lookupVal || lookupVal.length !== 7) {
            peerLookupStatus.textContent =
                "Error: Identity key must be exactly 6 characters.";
            return;
        }

        peerLookupStatus.textContent =
            "Querying cluster indexes...";

        try {

            const res =
                await fetch(`/api/identity/lookup/${lookupVal}`);

            const data = await res.json();

            if (res.ok) {

                const peers = JSON.parse(
                    localStorage.getItem("enclave_peers") || "{}"
                );

                peers[lookupVal] = data.public_key;

                localStorage.setItem(
                    "enclave_peers",
                    JSON.stringify(peers)
                );

                peerLookupStatus.textContent =
                    "Handshake resolved. Secure peer added.";

                inputPeerId.value = "";

                setTimeout(() => {
                    window.location.href = "/";
                }, 1200);

            } else {

                peerLookupStatus.textContent =
                    data.error || "Peer lookup failed.";

            }

        } catch (err) {

            console.error(err);

            peerLookupStatus.textContent =
                "Network pipeline timeout.";

        }

    });

});
