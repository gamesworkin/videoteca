// CONFIGURAÇÕES DO BANCO DE DADOS (JSONBIN.IO) E YOUTUBE API
const BIN_ID = "6a0f32256877513b27ad9e6e"; 
const MASTER_KEY = "$2a$10$SpMCqRLrFJc5TefzAacUB.5.zFYLg7WAOcHxZt83XiWW5OoTm/wey"; 
const YT_API_KEY = "AIzaSyDNHqERli0UuPqruQwd2UPIBg7nikrjqNE";

const CONFIG = {
    BIN_URL: `https://api.jsonbin.io/v3/b/${BIN_ID}`,
    HEADERS: {
        "Content-Type": "application/json",
        "X-Master-Key": MASTER_KEY
    }
};

const CREDENTIALS = { user: "admin", pass: "admin123" };
const SESSION_TIMEOUT = 30 * 60 * 1000; 

let allVideos = [];
let currentPlaylist = [];
let currentIndex = -1;

function getSafeTitle(v) { return v.título || v.titulo || "Sem Título"; }

document.addEventListener("DOMContentLoaded", () => {
    checkSession();
    setupAdminEvents();
    
    const sidebar = document.getElementById("sidebar");
    document.getElementById("toggle-menu").addEventListener("click", () => sidebar.classList.toggle("collapsed"));

    document.getElementById("search-input").addEventListener("input", (e) => {
        const term = e.target.value.toLowerCase().trim();
        const filtered = allVideos.filter(v => 
            getSafeTitle(v).toLowerCase().includes(term) || 
            (v.categoria || "").toLowerCase().includes(term) || 
            (v.subcategoria || "").toLowerCase().includes(term)
        );
        renderGrid(filtered, "Busca: " + term);
    });

    document.getElementById("login-form").addEventListener("submit", (e) => {
        e.preventDefault();
        if(document.getElementById("username").value === CREDENTIALS.user && 
           document.getElementById("password").value === CREDENTIALS.pass) {
            localStorage.setItem("session_active", "true");
            localStorage.setItem("session_start", new Date().getTime());
            initApp();
        } else {
            document.getElementById("login-error").style.display = "block";
        }
    });

    if(localStorage.getItem("session_active") === "true") initApp();
});

function checkSession() {
    const start = localStorage.getItem("session_start");
    if(start && (new Date().getTime() - start > SESSION_TIMEOUT)) logout();
}

function logout() { localStorage.clear(); location.reload(); }
document.getElementById("btn-logout").addEventListener("click", logout);

async function initApp() {
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("main-content").classList.remove("hidden");
    
    try {
        const res = await fetch(CONFIG.BIN_URL + "/latest", { headers: CONFIG.HEADERS });
        const data = await res.json();
        allVideos = data.record || [];
        
        buildSidebar(allVideos);
        renderGrid(allVideos, 'Início');
        setupModal();
        buildAdminManagementLists(); // Alimenta as listas administrativas de controle
    } catch (e) { 
        console.error("Erro ao ler banco remoto:", e); 
        alert("Erro de conexão. Verifique o BIN_ID e MASTER_KEY.");
    }
}

async function saveDatabaseRemotely(updatedArray) {
    const log = document.getElementById("admin-status");
    log.innerText = "Sincronizando com o banco remoto...";
    try {
        const res = await fetch(CONFIG.BIN_URL, {
            method: "PUT",
            headers: CONFIG.HEADERS,
            body: JSON.stringify(updatedArray)
        });
        if(res.ok) {
            allVideos = updatedArray;
            log.innerText = "Banco de dados atualizado com sucesso!";
            buildSidebar(allVideos);
            renderGrid(allVideos, 'Início');
            buildAdminManagementLists(); // Atualiza painel interno
            setTimeout(() => { log.innerText = ""; }, 3000);
        } else {
            log.innerText = "Erro ao gravar dados no servidor.";
        }
    } catch(e) {
        log.innerText = "Falha de rede ao sincronizar.";
    }
}

// SETUP DOS EVENTOS DO ADMIN (FORMS)
function setupAdminEvents() {
    const modal = document.getElementById("admin-modal");
    document.getElementById("btn-admin").onclick = () => modal.classList.remove("hidden");
    document.getElementById("close-admin").onclick = () => modal.classList.add("hidden");
    document.querySelector("#admin-modal .modal-backdrop").onclick = () => modal.classList.add("hidden");

    document.getElementById("manual-upload-form").onsubmit = async (e) => {
        e.preventDefault();
        const newVid = {
            "título": document.getElementById("m-title").value,
            "link": document.getElementById("m-link").value,
            "capa": document.getElementById("m-capa").value,
            "categoria": document.getElementById("m-cat").value,
            "subcategoria": document.getElementById("m-sub").value
        };
        await saveDatabaseRemotely([...allVideos, newVid]);
        document.getElementById("manual-upload-form").reset();
    };

    document.getElementById("yt-import-form").onsubmit = async (e) => {
        e.preventDefault();
        const log = document.getElementById("admin-status");
        let playlistId = document.getElementById("yt-playlist-id").value.trim();
        const cat = document.getElementById("yt-cat").value;
        const sub = document.getElementById("yt-sub").value;

        if(playlistId.includes("list=")) {
            playlistId = playlistId.split("list=")[1].split("&")[0];
        }

        log.innerText = "Chamando API do YouTube...";
        try {
            const ytUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${YT_API_KEY}`;
            const response = await fetch(ytUrl);
            const ytData = await response.json();

            if(!ytData.items || ytData.items.length === 0) {
                log.innerText = "Erro ao importar dados. Verifique o ID da playlist.";
                return;
            }

            const importedVideos = ytData.items.map(item => {
                const vId = item.snippet.resourceId.videoId;
                const thumbnails = item.snippet.thumbnails;
                const bestThumb = thumbnails.high ? thumbnails.high.url : (thumbnails.default ? thumbnails.default.url : "");
                return {
                    "título": item.snippet.title,
                    "capa": bestThumb,
                    "link": `https://www.youtube.com/embed/${vId}`,
                    "categoria": cat,
                    "subcategoria": sub
                };
            });

            await saveDatabaseRemotely([...allVideos, ...importedVideos]);
            document.getElementById("yt-import-form").reset();
        } catch(err) {
            log.innerText = "Erro ao ler dados da API do Google.";
        }
    };
}

// NOVA FUNÇÃO MASTER: Desenha as listas de edição/exclusão estrutural e de vídeos
function buildAdminManagementLists() {
    const structBody = document.getElementById("admin-structure-list");
    const videoBody = document.getElementById("admin-delete-list");
    
    structBody.innerHTML = "";
    videoBody.innerHTML = "";

    // 1. MAPEIA CATEGORIAS E SUBCATEGORIAS EXISTENTES UNICAS
    const categoriesSet = [...new Set(allVideos.map(v => v.categoria).filter(Boolean))];
    const subCategoriesMap = []; // Guarda objetos {cat: 'X', sub: 'Y'}
    
    allVideos.forEach(v => {
        if(v.categoria && v.subcategoria) {
            const exists = subCategoriesMap.some(item => item.cat === v.categoria && item.sub === v.subcategoria);
            if(!exists) subCategoriesMap.push({ cat: v.categoria, sub: v.subcategoria });
        }
    });

    // 2. INJETA CATEGORIAS NA TABELA DE ESTRUTURAS
    categoriesSet.forEach(catName => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><span style="color:#e50914; font-weight:bold;">CATEGORIA</span></td>
            <td style="font-weight:bold; color:#fff;">${catName}</td>
            <td>—</td>
            <td>
                <button class="btn-edit-item" title="Editar nome da Categoria"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-delete-item" title="Excluir Categoria inteira"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        // Evento Editar Categoria
        tr.querySelector(".btn-edit-item").onclick = () => {
            const newName = prompt(`Digite o novo nome para a categoria "${catName}":`, catName);
            if(newName && newName.trim() !== catName) {
                const updated = allVideos.map(v => v.categoria === catName ? { ...v, categoria: newName.trim() } : v);
                saveDatabaseRemotely(updated);
            }
        };
        // Evento Excluir Categoria
        tr.querySelector(".btn-delete-item").onclick = () => {
            if(confirm(`ATENÇÃO! Excluir a categoria "${catName}" apagará TODOS os vídeos atrelados a ela. Confirmar?`)) {
                const updated = allVideos.filter(v => v.categoria !== catName);
                saveDatabaseRemotely(updated);
            }
        };
        structBody.appendChild(tr);
    });

    // 3. INJETA SUBCATEGORIAS NA TABELA DE ESTRUTURAS
    subCategoriesMap.forEach(item => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><span style="color:#00ffcc; font-weight:bold;">SUBCATEGORIA</span></td>
            <td style="color:#eee;">${item.sub}</td>
            <td style="color:#777;">${item.cat}</td>
            <td>
                <button class="btn-edit-item" title="Editar nome da Subcategoria"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-delete-item" title="Excluir Subcategoria inteira"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        // Evento Editar Subcategoria
        tr.querySelector(".btn-edit-item").onclick = () => {
            const newName = prompt(`Digite o novo nome para a subcategoria "${item.sub}" (da categoria ${item.cat}):`, item.sub);
            if(newName && newName.trim() !== item.sub) {
                const updated = allVideos.map(v => (v.categoria === item.cat && v.subcategoria === item.sub) ? { ...v, subcategoria: newName.trim() } : v);
                saveDatabaseRemotely(updated);
            }
        };
        // Evento Excluir Subcategoria
        tr.querySelector(".btn-delete-item").onclick = () => {
            if(confirm(`Deseja apagar a subcategoria "${item.sub}" e todos os seus vídeos contidos em "${item.cat}"?`)) {
                const updated = allVideos.filter(v => !(v.categoria === item.cat && v.subcategoria === item.sub));
                saveDatabaseRemotely(updated);
            }
        };
        structBody.appendChild(tr);
    });

    // 4. INJETA LISTA DE VÍDEOS INDIVIDUAIS (PRESERVADO)
    if (allVideos.length === 0) {
        videoBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#555;">Nenhum vídeo na biblioteca.</td></tr>`;
        return;
    }
    allVideos.forEach((video, index) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td style="font-weight:bold; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${getSafeTitle(video)}</td>
            <td>${video.categoria || "Geral"}</td>
            <td>${video.subcategoria || "—"}</td>
            <td>
                <button class="btn-delete-item" title="Excluir este vídeo apenas"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tr.querySelector(".btn-delete-item").onclick = async () => {
            if (confirm(`Excluir apenas o vídeo "${getSafeTitle(video)}"?`)) {
                const updatedList = allVideos.filter((_, idx) => idx !== index);
                await saveDatabaseRemotely(updatedList);
            }
        };
        videoBody.appendChild(tr);
    });
}

function switchAdminTab(tabId) {
    document.querySelectorAll(".admin-tab-content").forEach(el => el.classList.add("hidden"));
    document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
    document.getElementById(tabId).classList.remove("hidden");
    event.currentTarget.classList.add("active");
}

// RENDERERS DE GRID EM MOSAICO E SIDEBAR (PRESERVADOS INTEGRALMENTE)
function buildSidebar(videos) {
    const menu = document.getElementById("sidebar-menu");
    const cats = [...new Set(videos.map(v => v.categoria).filter(Boolean))];
    menu.innerHTML = `<div class="category-item" onclick="resetHome()"><span><i class="fa-solid fa-house"></i> Início</span></div>`;
    
    cats.forEach(cat => {
        const group = document.createElement("div");
        group.className = "menu-category-group";
        const btn = document.createElement("div");
        btn.className = "category-item";
        btn.innerHTML = `<span><i class="fa-solid fa-folder"></i> ${cat}</span> <i class="fa-solid fa-chevron-down chevron"></i>`;
        
        const subList = document.createElement("ul");
        subList.className = "subcategory-list hidden";
        const subCats = [...new Set(videos.filter(v => v.categoria === cat).map(v => v.subcategoria).filter(Boolean))];
        
        subCats.forEach(sub => {
            const li = document.createElement("li");
            li.innerText = sub;
            li.onclick = (e) => { e.stopPropagation(); filterSub(cat, sub); };
            subList.appendChild(li);
        });

        btn.onclick = () => {
            subList.classList.toggle("hidden");
            btn.classList.toggle("expanded");
            filterCat(cat);
        };
        group.appendChild(btn);
        group.appendChild(subList);
        menu.appendChild(group);
    });
}

function resetHome() {
    document.getElementById("search-input").value = "";
    renderGrid(allVideos, 'Início');
}

function renderGrid(videos, title) {
    document.getElementById("current-view-title").innerText = title;
    const grid = document.getElementById("categories-grid");
    grid.innerHTML = "";

    const groups = {};
    videos.forEach(v => {
        if(!groups[v.categoria]) groups[v.categoria] = [];
        groups[v.categoria].push(v);
    });

    for(let name in groups) {
        const vids = groups[name];
        const card = document.createElement("div");
        card.className = "mosaic-card";
        card.innerHTML = `
            <img src="${vids[0].capa}" class="card-thumb">
            <div class="card-info">
                <h2>${name}</h2>
                <p>${vids.length} vídeos</p>
            </div>
        `;

        const subContainer = document.createElement("div");
        subContainer.className = "expanded-container hidden";

        card.onclick = () => {
            const isHidden = subContainer.classList.contains("hidden");
            document.querySelectorAll(".expanded-container").forEach(el => el.classList.add("hidden"));
            if(isHidden) {
                renderSubcategoriesInBody(vids, subContainer);
                subContainer.classList.remove("hidden");
            }
        };
        grid.appendChild(card);
        grid.appendChild(subContainer);
    }
}

function renderSubcategoriesInBody(videos, container) {
    container.innerHTML = `<div class="exp-title">Subcategorias</div>`;
    const subGrid = document.createElement("div");
    subGrid.className = "sub-mosaic-grid";

    const subs = {};
    videos.forEach(v => {
        const s = v.subcategoria || "Geral";
        if(!subs[s]) subs[s] = [];
        subs[s].push(v);
    });

    for(let sName in subs) {
        const sVids = subs[sName];
        const sCard = document.createElement("div");
        sCard.className = "mosaic-card";
        sCard.innerHTML = `
            <img src="${sVids[0].capa}" class="card-thumb">
            <div class="card-info">
                <h2>${sName}</h2>
                <p>${sVids.length} itens</p>
            </div>
        `;

        const videoContainer = document.createElement("div");
        videoContainer.className = "expanded-container hidden";
        videoContainer.style.background = "#050505";

        sCard.onclick = (e) => {
            e.stopPropagation();
            const isHidden = videoContainer.classList.contains("hidden");
            container.querySelectorAll(".expanded-container").forEach(el => el.classList.add("hidden"));
            if(isHidden) {
                renderVideosInBody(sVids, videoContainer);
                videoContainer.classList.remove("hidden");
            }
        };
        subGrid.appendChild(sCard);
        subGrid.appendChild(videoContainer);
    }
    container.appendChild(subGrid);
}

function renderVideosInBody(videos, container) {
    container.innerHTML = `<div class="exp-title">Vídeos disponíveis</div>`;
    const vGrid = document.createElement("div");
    vGrid.className = "videos-mosaic";

    videos.forEach(vid => {
        const vCard = document.createElement("div");
        vCard.className = "mosaic-card";
        vCard.innerHTML = `
            <img src="${vid.capa}" class="card-thumb">
            <div class="card-info">
                <h2>${getSafeTitle(vid)}</h2>
            </div>
        `;
        vCard.onclick = (e) => { e.stopPropagation(); openPlayer(vid, videos); };
        vGrid.appendChild(vCard);
    });
    container.appendChild(vGrid);
}

function filterCat(c) { renderGrid(allVideos.filter(v => v.categoria === c), c); }
function filterSub(c, s) { renderGrid(allVideos.filter(v => v.categoria === c && v.subcategoria === s), s); }

// PLAYER
function openPlayer(video, playlist) {
    currentPlaylist = playlist;
    currentIndex = playlist.findIndex(v => v.link === video.link);
    const modal = document.getElementById("video-modal");
    const wrapper = document.getElementById("player-wrapper");
    modal.classList.remove("hidden");
    document.getElementById("modal-video-title").innerText = getSafeTitle(video);

    const url = video.link.trim();
    if (/\.(mp4|webm|ogg|mov)($|\?)/i.test(url)) {
        wrapper.innerHTML = `<video id="main-player" controls autoplay><source src="${url}" type="video/mp4"></video>`;
        wrapper.querySelector('video').onended = () => changeVideo(1);
    } else {
        let fUrl = url;
        if (url.includes("youtube.com") || url.includes("youtu.be")) fUrl += (url.includes("?") ? "&" : "?") + "autoplay=1";
        wrapper.innerHTML = `<iframe id="main-player" src="${fUrl}" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
    }
}

function changeVideo(s) {
    currentIndex += s;
    if(currentIndex >= 0 && currentIndex < currentPlaylist.length) openPlayer(currentPlaylist[currentIndex], currentPlaylist);
    else closeModal();
}

// TIMEOUTS
function closeModal() {
    document.getElementById("video-modal").classList.add("hidden");
    document.getElementById("player-wrapper").innerHTML = "";
}

function setupModal() {
    document.getElementById("close-modal").onclick = closeModal;
    document.getElementById("next-video-btn").onclick = () => changeVideo(1);
    document.getElementById("prev-video-btn").onclick = () => changeVideo(-1);
    document.querySelector(".modal-backdrop").onclick = closeModal;
}
