document.addEventListener("DOMContentLoaded", () => {
    const inputAliasString = document.getElementById("aliasNameInput");
    const btnSaveAliasSubmit = document.getElementById("saveAliasBtn");
    const aliasStatusFeedback = document.getElementById("aliasStatusFeedback");

    let activePeerId = localStorage.getItem("matrix_active_peer_context") || "";

    btnSaveAliasSubmit.addEventListener("click", () => {
        if (!activePeerId) {
            aliasStatusFeedback.innerText = "ERR: NO ACTIVE VECTOR TARGET SELECTABLE";
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

        aliasStatusFeedback.className =
            "text-[10px] text-center text-green-500 font-bold tracking-wider";

        aliasStatusFeedback.innerText =
            "COMMIT CHANGE SUCCESSFUL. MONIKER ASSIGNED.";

        setTimeout(() => {
            window.location.href = "/";
        }, 800);
    });
});
