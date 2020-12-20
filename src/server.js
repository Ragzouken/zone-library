const { nanoid } = require("nanoid");
const { extname } = require ("path");
const { mkdir } = require("fs");

const express = require("express");
const fileUpload = require('express-fileupload');

require('dotenv').config();

process.title = "zone library";
mkdir(process.env.MEDIA_PATH, () => {});

const library = new Map();
library.set("yoda", {
    title: "yoda spins",
    media: "/",
    duration: "400s",
});

const app = express();
app.use(fileUpload({
    abortOnLimit: true,
    uriDecodeFileNames: true,
    limits: { fileSize: 16 * 1024 * 1024 },
}));

process.on('SIGINT', function() {
    process.exit();
});

app.use(express.static("public"));
app.use("/media", express.static("media"));

app.get("/library", (request, response) => {
    response.json(request.query.q);
});

app.get("/library/:id", (request, response) => {
    const info = library.get(request.params.id);

    if (info) {
        response.json(info);
    } else {
        response.status(404).json({ title: "Entry does not exist." });
    }
});

app.post("/library", async (request, response) => {
    const id = nanoid();
    const file = request.files.media;
    const type = extname(file.name);
    const path = `${process.env.MEDIA_PATH}/${id}${type}`;

    await file.mv(path);
    
    const info = {
        id,
        title: request.body.title,
        src: path,
    }
    
    library.set(id, info);
    response.json(info);
});

app.put("/library/:id", (request, response) => {
    
});

const listener = app.listen(process.env.PORT, "localhost", () => {
    console.log("zone library serving on " + listener.address().port);
});
