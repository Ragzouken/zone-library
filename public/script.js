async function libraryRequest(path, { search={}, auth, method="GET", body }={}) {
    const url = new URL(path, location.origin);
    url.searchParams = new URLSearchParams(search);
    const init = {
        method,
        headers: { 
            "Authorization": "Bearer " + auth, 
            "Content-Type": "application/json",
        },
        body,
    };
    return fetch(url, init).then((response) => response.json());
}

async function checkLibraryAuth(auth) {
    return libraryRequest("/library/auth", { method: "POST", auth });
}

async function searchLibrary(params) {
    return libraryRequest("/library", { search: params });
}

async function getLibraryEntry(id) {
    return libraryRequest("/library/" + id);
}

async function deleteLibraryEntry(id, auth) {
    return libraryRequest("/library/" + id, { method: "DELETE", auth });
}

async function retitleLibraryEntry(id, auth, title) {
    const body = JSON.stringify({ setTitle: title });
    return libraryRequest("/library/" + id, { method: "PATCH", auth, body });
}

async function tagLibraryEntry(id, auth, ...tags) {
    const body = JSON.stringify({ addTags: tags });
    return libraryRequest("/library/" + id, { method: "PATCH", auth, body });
}

async function untagLibraryEntry(id, auth, ...tags) {
    const body = JSON.stringify({ delTags: tags });
    return libraryRequest("/library/" + id, { method: "PATCH", auth, body });
}

async function uploadMedia(auth, media, title) {
    const url = new URL("/library", location.origin);
    const body = new FormData();
    body.set("title", title);
    body.set("media", media);
    const init = {
        method: "POST",
        headers: { 
            "Authorization": "Bearer " + auth,
        },
        body,
    };
    return fetch(url, init).then((response) => response.json());
}

async function uploadSubtitle(auth, id, subtitles) {
    const url = new URL(`/library/${id}/subtitles`, location.origin);
    const body = new FormData();
    body.set("subtitles", subtitles);
    const init = {
        method: "PUT",
        headers: { 
            "Authorization": "Bearer " + auth,
        },
        body,
    };
    return fetch(url, init).then((response) => response.json());
}

async function downloadYoutube(auth, youtubeId) {
    const url = new URL(`/library-get-youtube`, location.origin);
    const body = new FormData();
    body.set("youtubeId", youtubeId);
    const init = {
        method: "POST",
        headers: { 
            "Authorization": "Bearer " + auth,
        },
        body,
    };
    return fetch(url, init).then((response) => response.json());
}

async function downloadTweet(auth, tweetURL) {
    const url = new URL(`/library-get-tweet`, location.origin);
    const body = new FormData();
    body.set("url", tweetURL);
    const init = {
        method: "POST",
        headers: { 
            "Authorization": "Bearer " + auth,
        },
        body,
    };
    return fetch(url, init).then((response) => response.json());
}

async function refresh() {
    const entries = await searchLibrary();
    const titles = entries.map((entry) => entry.title);

    const container = document.getElementById("library-container");
    container.innerHTML = "";
    entries.forEach((entry) => {
        const row = html(
            "div", 
            { class: "library-row" }, 
            html("div", { class: "row-title" }, entry.title), 
            html("div", { class: "row-duration" } , secondsToTime(entry.duration / 1000)),
        );
        row.addEventListener("click", () => select(entry));
        container.appendChild(row);
    });

    return entries;
}

const pad2 = (part) => (part.toString().length >= 2 ? part.toString() : '0' + part.toString());
function secondsToTime(seconds) {
    if (isNaN(seconds)) return '??:??';

    const s = Math.floor(seconds % 60);
    const m = Math.floor(seconds / 60) % 60;
    const h = Math.floor(seconds / 3600);

    return h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tagName 
 * @param {*} attributes 
 * @param  {...(Node | string)} children 
 * @returns {HTMLElementTagNameMap[K]}
 */
function html(tagName, attributes = {}, ...children) {
    const element = /** @type {HTMLElementTagNameMap[K]} */ (document.createElement(tagName)); 
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    children.forEach((child) => element.append(child));
    return element;
}

async function start() {
    let auth;
    document.getElementById("auth-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        const authAttempt = formData.get('password');
        const result = await checkLibraryAuth(authAttempt).catch(() => ({}));
        if (result.authorized) {
            auth = authAttempt;
            form.hidden = true;
            document.querySelectorAll('.requires-auth').forEach(i => {
                i.hidden = false;
            });
        }
    });

    document.getElementById("selected-retitle").addEventListener("click", async () => {
        const title = document.getElementById("selected-title").value;
        const result = await retitleLibraryEntry(selectedEntry.mediaId, auth, title);

        const entries = await refresh();

        if (result.mediaId) {
            const selected = entries.find((entry) => entry.mediaId === selectedEntry.mediaId);
            select(selected);
        }
    });

    document.getElementById("selected-tag").addEventListener("click", async () => {
        const tagname = document.getElementById("selected-tagname").value;
        const result = await tagLibraryEntry(selectedEntry.mediaId, auth, tagname);

        const entries = await refresh();

        if (result.mediaId) {
            const selected = entries.find((entry) => entry.mediaId === selectedEntry.mediaId);
            select(selected);
            document.getElementById("selected-tagname").value = "";
        }
    });

    document.getElementById("selected-untag").addEventListener("click", async () => {
        const tagname = document.getElementById("selected-tagname").value;
        const result = await untagLibraryEntry(selectedEntry.mediaId, auth, tagname);

        const entries = await refresh();

        if (result.mediaId) {
            const selected = entries.find((entry) => entry.mediaId === selectedEntry.mediaId);
            select(selected);
            document.getElementById("selected-tagname").value = "";
        }
    });

    const uploadProgress = document.getElementById("upload-progress");
    document.getElementById("upload-button").addEventListener("click", async () => {
        try {
            const title = document.getElementById("upload-title").value;
            const media = document.getElementById("upload-media").files[0];

            uploadProgress.innerHTML = "uploading...";
            const result = await uploadMedia(auth, media, title);
            const entries = await refresh();

            if (result.mediaId) {
                uploadProgress.innerHTML = "done!";
                const selected = entries.find((entry) => entry.mediaId === result.mediaId);
                select(selected);
            } else {
                uploadProgress.innerHTML = result.title;
            }
        } catch (e) {
            uploadProgress.innerHTML = e.toString();
        }
    });

    document.getElementById("subtitle-upload").addEventListener("click", async () => {
        const subtitle = document.getElementById("subtitle-file").files[0];
        const result = await uploadSubtitle(auth, selectedEntry.mediaId, subtitle);
        const entries = await refresh();

        if (result.mediaId) {
            const selected = entries.find((entry) => entry.mediaId === result.mediaId);
            select(selected);
        }
    });

    document.getElementById("youtube-button").addEventListener("click", async () => {
        const input = document.getElementById("youtube-url");
        const url = input.value;
        input.value = "";
        const youtubeId = new URL(url).searchParams.get("v");
        console.log(youtubeId);

        const result = await downloadYoutube(auth, youtubeId);
        const entries = await refresh();

        if (result.mediaId) {
            const selected = entries.find((entry) => entry.mediaId === result.mediaId);
            select(selected);
        }
    });

    document.getElementById("tweet-button").addEventListener("click", async () => {
        const input = document.getElementById("tweet-url");
        const url = input.value;
        input.value = "";
        const result = await downloadTweet(auth, url);
        const entries = await refresh();

        if (result.mediaId) {
            const selected = entries.find((entry) => entry.mediaId === result.mediaId);
            select(selected);
        }
    });

    refresh();
}

let selectedEntry = undefined;
function select(entry) {
    const selectedContainer = document.getElementById("selected");
    const previewVideo = document.getElementById("selected-preview");
    const titleInput = document.getElementById("selected-title");
    const tagsContainer = document.getElementById("selected-tags");

    selectedEntry = entry;
    selectedContainer.hidden = false;
    previewVideo.src = new URL(entry.src, location.origin);
    titleInput.value = entry.title;
    tagsContainer.innerHTML = entry.tags.join(", ");

    previewVideo.innerHTML = "";
    if (entry.subtitle) {
        const subtrack = document.createElement('track');
        subtrack.kind = 'subtitles';
        subtrack.label = 'english';
        subtrack.src = new URL(entry.subtitle, location.origin);
        previewVideo.appendChild(subtrack);
        previewVideo.textTracks[0].mode = 'showing';
    }
}
