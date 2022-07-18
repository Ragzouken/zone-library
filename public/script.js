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

async function getSizeLimit() {
    const url = new URL("/library-limit", location.origin);
    return fetch(url).then((response) => response.json()).then((j) => j.limit);
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

    const container = document.querySelector("#library-container ul");
    container.replaceChildren();
    entries.forEach((entry, index) => {
        const classes = ["library-row", ...entry.tags.map(tag => "tag-" + tag)].join(" ");
        const row = html(
            "li", 
            { class: classes, 'data-title': entry.title, 'data-index': index }, 
            html("span", { class: "row-title" }, entry.title), 
            html("time", { class: "row-duration", datetime: `${entry.duration / 1000}S` } , secondsToTime(entry.duration / 1000)),
        );
        row.addEventListener("click", () => select(entry));
        container.appendChild(row);
    });
    const tagContainer = document.getElementById('tags');
    tagContainer.textContent = '';
        Object.entries(
            entries
                .flatMap(i => i.tags)
                .reduce((tags, tag) => {
                    tags[tag] = (tags[tag] || 0) + 1;
                    return tags;
                }, {})
        )
            .sort(([, a], [, b]) => b - a)
            .forEach(([tag]) => {
                const option = document.createElement('option');
                option.value = tag;
                tagContainer.appendChild(option);
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
        form.classList.add('busy');
        try {
            const formData = new FormData(form);
            const authAttempt = formData.get('password');
            const result = await checkLibraryAuth(authAttempt).catch(() => ({}));
            if (result.authorized) {
                auth = authAttempt;
                document.documentElement.classList.add('authorized');
            }
        } finally {
            form.classList.remove('busy');
        }
    });

    document.getElementById("retitle-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        form.classList.add('busy');
        try {
            const formData = new FormData(form);
            const title = formData.get("title");
            const result = await retitleLibraryEntry(selectedEntry.mediaId, auth, title);

            const entries = await refresh();

            if (result.mediaId) {
                const selected = entries.find((entry) => entry.mediaId === selectedEntry.mediaId);
                select(selected);
            }
        } finally {
            form.classList.remove('busy');
        }
    });

    document.getElementById("tag-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        form.classList.add('busy');
        try {
            const formData = new FormData(form);
            const tagname = formData.get("tagname");
            const action = event.submitter.value === 'tag' ? tagLibraryEntry : untagLibraryEntry;
            const result = await action(selectedEntry.mediaId, auth, tagname);

            const entries = await refresh();

            if (result.mediaId) {
                const selected = entries.find((entry) => entry.mediaId === selectedEntry.mediaId);
                select(selected);
                form.reset();
            }
        } finally {
            form.classList.remove('busy');
        }
    });

    const uploadProgress = document.getElementById("upload-progress");
    document.getElementById("upload-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        form.classList.add('busy');
        try {
            const formData = new FormData(form);
            const title = formData.get("title");
            const media = formData.get("media");

            uploadProgress.innerText = "";
            uploadProgress.appendChild(document.createElement('progress'));

            const limit = await getSizeLimit();
            if (media.size > limit) {
                throw Error(`File too big. Limit ${(limit / 1024 / 1024)|0} MiB`)
            }

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
        } finally {
            form.classList.remove('busy');
        }
    });

    document.getElementById("subtitles-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        form.classList.add('busy');
        try {
            const formData = new FormData(form);
            const subtitle = formData.get("file");
            const result = await uploadSubtitle(auth, selectedEntry.mediaId, subtitle);
            const entries = await refresh();

            if (result.mediaId) {
                const selected = entries.find((entry) => entry.mediaId === result.mediaId);
                select(selected);
            }
        } finally {
            form.classList.remove('busy');
        }
    });

    document.getElementById("youtube-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        form.classList.add('busy');
        try {
            const formData = new FormData(form);
            const url = formData.get("url");
            form.reset();
            const youtubeId = new URL(url).searchParams.get("v");
            console.log(youtubeId);

            const result = await downloadYoutube(auth, youtubeId);
            const entries = await refresh();

            if (result.mediaId) {
                const selected = entries.find((entry) => entry.mediaId === result.mediaId);
                select(selected);
            }
        } finally {
            form.classList.remove('busy');
        }
    });

    document.getElementById("tweet-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        form.classList.add('busy');
        try {
            const formData = new FormData(form);
            const url = formData.get("url");
            form.reset();
            const result = await downloadTweet(auth, url);
            const entries = await refresh();

            if (result.mediaId) {
                const selected = entries.find((entry) => entry.mediaId === result.mediaId);
                select(selected);
            }
        } finally {
            form.classList.remove('busy');
        }
    });

    const filterStyle = document.getElementById("library-filter-style");
    document.getElementById("library-filter-input").addEventListener("input", (event) => {
        filterStyle.textContent = event.currentTarget.value && `
.library-row:not([data-title*="${event.currentTarget.value.replace(/"/g, '\\"')}"i]) {
    display: none;
}`;
    });

    function onSort(event) {
        const by = event.currentTarget.value;
        const container = document.querySelector("#library-container ul");
        const children = Array.from(container.children);
        children.sort((a, b) => (a.dataset[by] || '').localeCompare((b.dataset[by] || ''), undefined, { sensitivity: 'base', ignorePunctuation: true, numeric: true }));
        container.children.length = 0;
        children.forEach(c => container.appendChild(c));
    };
    Array.from(document.querySelectorAll("#library-sort-input input")).forEach(i => i.addEventListener("change", onSort));

    refresh();
}

let selectedEntry = undefined;
function select(entry) {
    const selectedContainer = document.getElementById("selected");
    const previewVideo = document.getElementById("selected-preview");
    const titleInput = document.getElementById("selected-title");
    const tagsContainer = document.getElementById("selected-tags");
    const subtitlesLink = document.getElementById('subtitles-link');

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
        subtitlesLink.href = subtrack.src;
    } else {
        subtitlesLink.href = '';
    }
}
