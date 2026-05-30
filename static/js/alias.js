document.addEventListener("DOMContentLoaded", () => {
    const inputAliasString = document.getElementById("input-alias-string");
    const btnSaveAliasSubmit = document.getElementById("btn-save-alias-submit");
    const aliasStatusFeedback = document.getElementById("aliasStatusFeedback");

    // Pull active peer ID context if checking from URL parameters or session context
    // Defaulting logic looks at current system state variables
    let activePeerId = localStorage.getItem("matrix_active_peer_context") || ""; 

    if (btnSaveAliasSubmit) {
        btnSaveAliasSubmit.onclick = () => {
            // Fallback safety catch
            if (!activePeerId) {
                if (aliasStatusFeedback) aliasStatusFeedback.innerText = "ERR: NO ACTIVE VECTOR TARGET SELECTABLE";
                return;
            }
            
            const aliases = JSON.parse(localStorage.getItem("matrix_contact_aliases") || "{}");
            const newAlias = inputAliasString.value.trim();
            
            if (newAlias === "") {
                delete aliases[activePeerId];
            } else {
                aliases[activePeerId] = newAlias;
            }
            
            localStorage.setItem("matrix_contact_aliases", JSON.stringify(aliases));
            
            if (aliasStatusFeedback) {
                aliasStatusFeedback.className = "text-[10px] text-center text-green-500 font-bold tracking-wider";
                aliasStatusFeedback.innerText = "COMMIT CHANGE SUCCESSFUL. MONIKER ASSIGNED.";
            }

            setTimeout(() => {
                window.location.href = "/";
            }, 800);
        };
    }
});
