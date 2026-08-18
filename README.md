# Parallax frontend

React/Vite editor for the Parallax project-scoped media agent.

## Run locally

Start the backend first on port 8080, then:

```bash
npm install
npm run dev
```

The frontend uses `http://localhost:8080` by default. Override it when needed:

```bash
VITE_API_URL=http://127.0.0.1:8080 npm run dev
```

## Connected workflow

1. Create or select a project in the top bar. The trash control deletes the
   current project and everything stored with it (media, transcripts,
   embeddings, chats, timeline, and history).
2. Upload video, audio, image, or subtitle files.
3. Click or drag media from the bin onto the timeline. A video drop creates
   linked **V1 + A1** clips from the same file. **C** / **B** / **⌘K** splits
   at the playhead, **S** toggles snap, **R** switches overwrite and ripple,
   and **U** unlinks a pair. Program (and Sequence export) share one model:
   V1 under V2, mixed A1/A2, and black gaps.
4. Ask Director to inspect or transform project files, or to generate a still
   into the bin. Attach a reference image in chat (paperclip, paste, or drop)
   so Director can see it. You can also ask it to edit an uploaded or generated still
   by describing it — stills are captioned on ingest so Director can search the bin.
   Uploaded video is split into visual shots and described the same way.
   The bin search bar matches filenames and the project index (stills, shots, speech).
   If the backend `.env` lists more than one model, the chat composer can
   switch among them and set the Director's thinking effort to Low, Medium,
   or High. Image generation needs `GEMINI_API_KEY` on the backend; generated
   stills appear in the bin and can be placed on the timeline.
5. Hover a bin item to delete it from the project. Timeline clips that used it
   are removed with the file.
6. Use Export to pick format, quality, resolution, frame rate, and range, then
   download the render.
7. Director applies edits to the current clip in the bin. Separate files appear
   only when you ask for an export, highlight, or extract.

Project metadata, media, Director chats, and the timeline sequence are
persisted by the Go backend. Each project can have multiple chats. The cut
(clip order, trims, source in-points, playhead, zoom) is saved with the
project and restored on reload.
