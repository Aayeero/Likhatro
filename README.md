# Likhatro

A playful, browser-only photobooth for tablets and desktops. Likhatro lets users choose or customize a frame, apply a visual style, capture photos with a timer, retake individual shots, and download the finished memory.

## Run it

Camera access requires a secure browser context. Start a local web server in this folder instead of opening `index.html` directly.

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000>.

No packages, build step, account, backend, or database are required.

## Privacy

Photos are processed locally in the browser. They are not uploaded or saved after the page is closed unless the user downloads them.
