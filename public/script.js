async function refresh() {
    const entries = await fetch("/library").then((response) => response.json());
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
        container.appendChild(row);
    });
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
